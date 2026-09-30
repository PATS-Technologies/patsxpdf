import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    await requireUser("params-1");
    const result = await query("SELECT code, value, description FROM app_param ORDER BY code");
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser("params-2");
    const data = z.object({ code: z.string().min(1), value: z.string() }).parse(await request.json());
    const result = await query(
      "UPDATE app_param SET value=$2, updated_at=now(), updated_by=$3 WHERE code=$1 RETURNING code, value, description",
      [data.code, data.value, user.id],
    );
    return NextResponse.json(result.rows[0]);
  } catch (error) { return apiError(error); }
}
