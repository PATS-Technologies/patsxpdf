import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    await requireUser("params-1");
    const result = await query("SELECT code, value, description FROM app_param ORDER BY code");
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error, request); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser("params-2");
    const data = z.object({ code: z.string().min(1), value: z.string() }).parse(await request.json());
    const parameter = await transaction(async (client) => {
      const previous = await client.query<{ value: string | null }>("SELECT value FROM app_param WHERE code=$1 FOR UPDATE", [data.code]);
      const result = await client.query(
        "UPDATE app_param SET value=$2, updated_at=now(), updated_by=$3 WHERE code=$1 RETURNING code, value, description",
        [data.code, data.value, user.id],
      );
      await writeAudit({ actorId: user.id, action: "parameter.update", resourceType: "app_param", resourceId: data.code, details: { previousValue: previous.rows[0]?.value ?? null, newValue: data.value }, request }, client);
      return result.rows[0];
    });
    return NextResponse.json(parameter);
  } catch (error) { return apiError(error, request); }
}
