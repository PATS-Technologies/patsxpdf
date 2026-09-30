import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { canAccess } from "@/lib/privileges";

const COOKIE_NAME = "patsxpdf-session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "development-only-change-me");

export interface SessionUser {
  id: number;
  login: string;
  name: string;
  isAdmin: boolean;
  privileges: string[];
}

interface SessionPayload extends JWTPayload {
  userId: number;
}

async function loadUser(userId: number): Promise<SessionUser | null> {
  const result = await query<{
    id: string; login: string; name: string; locked: boolean; deleted: boolean; privileges: string[] | null;
  }>(`
    SELECT u.id, u.login, u.name, u.locked, u.deleted,
      array_remove(array_agg(DISTINCT p.code), NULL) AS privileges
    FROM app_user u
    LEFT JOIN user_role ur ON ur.user_id = u.id
    LEFT JOIN role_privilege rp ON rp.role_id = ur.role_id
    LEFT JOIN privilege p ON p.id = rp.privilege_id
    WHERE u.id = $1
    GROUP BY u.id
  `, [userId]);
  const row = result.rows[0];
  if (!row || row.locked || row.deleted) return null;
  const privileges = row.privileges ?? [];
  return { id: Number(row.id), login: row.login, name: row.name, isAdmin: privileges.includes("admin"), privileges };
}

export async function validateCredentials(login: string, password: string) {
  const result = await query<{ id: string; password_hash: string; locked: boolean; deleted: boolean }>(`
    SELECT id, password_hash, locked, deleted FROM app_user
    WHERE lower(login) = lower($1) OR lower(email) = lower($1)
    LIMIT 1
  `, [login.trim()]);
  const row = result.rows[0];
  if (!row || row.locked || row.deleted || !(await bcrypt.compare(password, row.password_hash))) return null;
  return loadUser(Number(row.id));
}

export async function createSession(userId: number) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await new SignJWT({ userId } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getSessionUser() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, secret, { algorithms: ["HS256"] });
    return loadUser(Number(payload.userId));
  } catch {
    return null;
  }
}

export async function requireUser(privilege?: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (privilege && !canAccess(user.privileges, privilege)) throw new Error("FORBIDDEN");
  return user;
}
