import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { query, transaction } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { canAccess } from "@/lib/privileges";
import { getUserInitials } from "@/lib/user-initials";
import { localeCookie, type Locale } from "@/lib/i18n";
import { verifyPasswordActivation } from "@/lib/password-activation";

const COOKIE_NAME = "patsxpdf-session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "development-only-change-me");

export interface SessionUser {
  id: number;
  login: string;
  name: string;
  initials: string;
  preferredLocale: Locale;
  isAdmin: boolean;
  privileges: string[];
}

interface SessionPayload extends JWTPayload {
  userId: number;
}

async function loadUser(userId: number): Promise<SessionUser | null> {
  const result = await query<{
    id: string; login: string; name: string; initials: string | null; preferred_locale: Locale; locked: boolean; deleted: boolean; privileges: string[] | null;
  }>(`
    SELECT u.id, u.login, u.name, u.initials, u.preferred_locale, u.locked, u.deleted,
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
  return { id: Number(row.id), login: row.login, name: row.name, initials: row.initials || getUserInitials(row.name), preferredLocale: row.preferred_locale, isAdmin: privileges.includes("admin"), privileges };
}

export async function validateCredentials(login: string, password: string) {
  const result = await query<{ id: string; password_hash: string; password_expired: boolean; locked: boolean; deleted: boolean }>(`
    SELECT id, password_hash, password_expired, locked, deleted FROM app_user
    WHERE lower(login) = lower($1) OR lower(email) = lower($1)
    LIMIT 1
  `, [login.trim()]);
  const row = result.rows[0];
  if (!row || row.locked || row.deleted) return { status: "invalid" } as const;
  if (row.password_expired) return { status: "password-expired" } as const;
  if (!(await bcrypt.compare(password, row.password_hash))) return { status: "invalid" } as const;
  const user = await loadUser(Number(row.id));
  return user ? { status: "valid", user } as const : { status: "invalid" } as const;
}

export async function activatePassword(login: string, activationCode: string, password: string, request: Request) {
  const result = await query<{
    id: string; activation_code_hash: string | null; activation_code_expires_at: Date | null; password_expired: boolean; locked: boolean; deleted: boolean;
  }>(`
    SELECT id, activation_code_hash, activation_code_expires_at, password_expired, locked, deleted
    FROM app_user
    WHERE lower(login) = lower($1) OR lower(email) = lower($1)
    LIMIT 1
  `, [login.trim()]);
  const row = result.rows[0];
  if (!row || row.locked || row.deleted || !row.password_expired || !row.activation_code_hash || !row.activation_code_expires_at) return { status: "invalid" } as const;
  if (row.activation_code_expires_at.getTime() <= Date.now()) return { status: "expired" } as const;
  if (!(await verifyPasswordActivation(activationCode, row.activation_code_hash))) return { status: "invalid" } as const;
  const passwordHash = await bcrypt.hash(password, 12);
  const updated = await transaction(async (client) => {
    const result = await client.query(`
      UPDATE app_user
      SET password_hash=$2,password_expired=false,activation_code_hash=NULL,activation_code_expires_at=NULL,updated_at=now()
      WHERE id=$1 AND password_expired AND activation_code_hash=$3
    `, [row.id, passwordHash, row.activation_code_hash]);
    if (!result.rowCount) return false;
    await writeAudit({ actorId: Number(row.id), action: "auth.password.activate", resourceType: "app_user", resourceId: Number(row.id), request }, client);
    return true;
  });
  if (!updated) return { status: "invalid" } as const;
  const user = await loadUser(Number(row.id));
  return user ? { status: "valid", user } as const : { status: "invalid" } as const;
}

export async function createSession(userId: number, preferredLocale: Locale) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await new SignJWT({ userId } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  cookieStore.set(localeCookie, preferredLocale, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
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
