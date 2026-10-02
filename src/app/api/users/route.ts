import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { getUserInitials } from "@/lib/user-initials";
import { writeAudit } from "@/lib/audit";
import { serverTranslate } from "@/lib/i18n-server";
import { locales } from "@/lib/i18n";
import { createPasswordActivation } from "@/lib/password-activation";

const userSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  login: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  initials: z.string().trim().min(1).max(3).transform((value) => value.toLocaleUpperCase("pt-BR")),
  email: z.string().trim().max(160).refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), "Invalid email address"),
  gender: z.enum(["M", "F"]).nullable(),
  preferredLocale: z.enum(locales),
  roleIds: z.array(z.coerce.number().int().positive()).min(1),
  password: z.preprocess((value) => value === "" || value == null ? undefined : value, z.string().min(5).optional()),
});

export async function GET() {
  try {
    await requireUser("users-1");
    const result = await query<{ id: string }>(`
      SELECT u.id, u.login, u.name, u.initials, u.email, u.gender, u.preferred_locale, u.locked, u.password_expired,
        coalesce(json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
          FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
      FROM app_user u
      LEFT JOIN user_role ur ON ur.user_id=u.id
      LEFT JOIN role r ON r.id=ur.role_id
      WHERE NOT u.deleted
      GROUP BY u.id ORDER BY lower(u.login)
    `);
    return NextResponse.json(result.rows.map((user) => ({ ...user, id: Number(user.id) })));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser("users-2");
    const data = userSchema.omit({ id: true, password: true }).parse(await request.json());
    const activation = await createPasswordActivation();
    const id = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(`
        INSERT INTO app_user (login, name, initials, email, gender, preferred_locale, password_hash, password_expired, activation_code_hash, activation_code_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9) RETURNING id
      `, [data.login, data.name, data.initials || getUserInitials(data.name), data.email, data.gender, data.preferredLocale, "!UNSET!", activation.hash, activation.expiresAt]);
      const userId = Number(created.rows[0].id);
      for (const roleId of data.roleIds) await client.query("INSERT INTO user_role(user_id, role_id) VALUES ($1,$2)", [userId, roleId]);
      await writeAudit({ actorId: actor.id, action: "user.create", resourceType: "app_user", resourceId: userId, details: { login: data.login, roleIds: data.roleIds, preferredLocale: data.preferredLocale }, request }, client);
      return userId;
    });
    return NextResponse.json({ id, activationCode: activation.code, activationExpiresAt: activation.expiresAt }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireUser("users-2");
    const data = userSchema.extend({ id: z.coerce.number().int().positive() }).parse(await request.json());
    if (data.password && !actor.isAdmin) throw new Error("FORBIDDEN");
    await transaction(async (client) => {
      await client.query(
        "UPDATE app_user SET name=$2,initials=$3,email=$4,gender=$5,preferred_locale=$6,updated_at=now() WHERE id=$1 AND NOT deleted",
        [data.id, data.name, data.initials || getUserInitials(data.name), data.email, data.gender, data.preferredLocale],
      );
      if (data.password) {
        await client.query("UPDATE app_user SET password_hash=$2,password_expired=false,activation_code_hash=NULL,activation_code_expires_at=NULL WHERE id=$1", [data.id, await bcrypt.hash(data.password, 12)]);
      }
      await client.query("DELETE FROM user_role WHERE user_id=$1", [data.id]);
      for (const roleId of data.roleIds) await client.query("INSERT INTO user_role(user_id, role_id) VALUES ($1,$2)", [data.id, roleId]);
      await writeAudit({ actorId: actor.id, action: "user.update", resourceType: "app_user", resourceId: data.id, details: { roleIds: data.roleIds, passwordChanged: Boolean(data.password), preferredLocale: data.preferredLocale }, request }, client);
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireUser("users-9");
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id || id === actor.id) return NextResponse.json({ error: await serverTranslate("error.invalidUserDelete") }, { status: 400 });
    await transaction(async (client) => {
      await client.query("UPDATE app_user SET deleted=true,updated_at=now() WHERE id=$1", [id]);
      await writeAudit({ actorId: actor.id, action: "user.delete", resourceType: "app_user", resourceId: id, request }, client);
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
