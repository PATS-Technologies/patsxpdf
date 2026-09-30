import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser("users-9");
    const { id: rawId } = await params;
    const id = Number(rawId);
    const { action } = z.object({ action: z.enum(["toggle-lock", "expire-password"]) }).parse(await request.json());
    if (!id || id === actor.id) return NextResponse.json({ error: "Não é permitido alterar a própria conta." }, { status: 400 });
    if (action === "toggle-lock") await query("UPDATE app_user SET locked=NOT locked,updated_at=now() WHERE id=$1 AND NOT deleted", [id]);
    else await query("UPDATE app_user SET password_hash=$2,password_expired=true,updated_at=now() WHERE id=$1 AND NOT deleted", [id, await bcrypt.hash("<EXPIRED>", 12)]);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
