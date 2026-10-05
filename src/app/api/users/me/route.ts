import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { transaction, query } from "@/lib/db";
import { apiError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { locales } from "@/lib/i18n";
import { setLocaleCookie } from "@/lib/i18n-server";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  initials: z.string().trim().min(1).max(3).transform((value) => value.toLocaleUpperCase("pt-BR")),
  email: z.string().trim().max(160).refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), "Invalid email address"),
  gender: z.enum(["M", "F"]).nullable(),
  preferredLocale: z.enum(locales),
  password: z.preprocess((value) => value === "" || value == null ? undefined : value, z.string().min(5).optional()),
});

export async function GET(request: Request) {
  try {
    const actor = await requireUser();
    const result = await query(`
      SELECT u.id,u.login,u.name,u.initials,u.email,u.gender,u.preferred_locale,u.locked,u.password_expired,
        coalesce(json_agg(json_build_object('id',r.id,'name',r.name,'description',r.description) ORDER BY r.name)
          FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
      FROM app_user u
      LEFT JOIN user_role ur ON ur.user_id=u.id
      LEFT JOIN role r ON r.id=ur.role_id
      WHERE u.id=$1 AND NOT u.deleted
      GROUP BY u.id
    `, [actor.id]);
    return NextResponse.json(result.rows[0]);
  } catch (error) { return apiError(error, request); }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireUser();
    const data = profileSchema.parse(await request.json());
    await transaction(async (client) => {
      await client.query(
        "UPDATE app_user SET name=$2,initials=$3,email=$4,gender=$5,preferred_locale=$6,updated_at=now() WHERE id=$1 AND NOT deleted",
        [actor.id, data.name, data.initials, data.email, data.gender, data.preferredLocale],
      );
      if (data.password) {
        await client.query("UPDATE app_user SET password_hash=$2,password_expired=false,activation_code_hash=NULL,activation_code_expires_at=NULL WHERE id=$1", [actor.id, await bcrypt.hash(data.password, 12)]);
      }
      await writeAudit({ actorId: actor.id, action: "user.profile.update", resourceType: "app_user", resourceId: actor.id, details: { preferredLocale: data.preferredLocale, passwordChanged: Boolean(data.password) }, request }, client);
    });
    await setLocaleCookie(data.preferredLocale);
    return NextResponse.json({ ok: true, preferredLocale: data.preferredLocale });
  } catch (error) { return apiError(error, request); }
}