import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    await requireUser("users-1");
    const result = await query("SELECT id, name, description FROM role ORDER BY name");
    return Response.json(result.rows);
  } catch (error) { return apiError(error); }
}
