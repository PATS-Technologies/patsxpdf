import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";

const userSchema = z.object({
  id: z.number().int().positive().optional(),
  login: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  email: z.string().email().max(160),
  gender: z.enum(["M", "F"]),
  roleIds: z.array(z.number().int().positive()).min(1),
  password: z.string().min(5).optional(),
});

export async function GET() {
  try {
    await requireUser("users-1");
    const result = await query(`
      SELECT u.id, u.login, u.name, u.email, u.gender, u.locked, u.password_expired,
        coalesce(json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
          FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
      FROM app_user u
      LEFT JOIN user_role ur ON ur.user_id=u.id
      LEFT JOIN role r ON r.id=ur.role_id
      WHERE NOT u.deleted
      GROUP BY u.id ORDER BY lower(u.login)
    `);
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser("users-2");
    const data = userSchema.parse(await request.json());
    if (data.password && !actor.isAdmin) throw new Error("FORBIDDEN");
    const passwordHash = await bcrypt.hash(data.password ?? "<EXPIRED>", 12);
    const id = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(`
        INSERT INTO app_user (login, name, email, gender, password_hash, password_expired)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
      `, [data.login, data.name, data.email, data.gender, passwordHash, !data.password]);
      const userId = Number(created.rows[0].id);
      for (const roleId of data.roleIds) await client.query("INSERT INTO user_role(user_id, role_id) VALUES ($1,$2)", [userId, roleId]);
      return userId;
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireUser("users-2");
    const data = userSchema.extend({ id: z.number().int().positive() }).parse(await request.json());
    if (data.password && !actor.isAdmin) throw new Error("FORBIDDEN");
    await transaction(async (client) => {
      await client.query(
        "UPDATE app_user SET name=$2,email=$3,gender=$4,updated_at=now() WHERE id=$1 AND NOT deleted",
        [data.id, data.name, data.email, data.gender],
      );
      if (data.password) {
        await client.query("UPDATE app_user SET password_hash=$2,password_expired=false WHERE id=$1", [data.id, await bcrypt.hash(data.password, 12)]);
      }
      await client.query("DELETE FROM user_role WHERE user_id=$1", [data.id]);
      for (const roleId of data.roleIds) await client.query("INSERT INTO user_role(user_id, role_id) VALUES ($1,$2)", [data.id, roleId]);
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireUser("users-9");
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id || id === actor.id) return NextResponse.json({ error: "Usuário inválido para exclusão." }, { status: 400 });
    await query("UPDATE app_user SET deleted=true,updated_at=now() WHERE id=$1", [id]);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
