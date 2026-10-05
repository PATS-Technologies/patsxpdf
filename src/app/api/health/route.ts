import { query } from "@/lib/db";
import { recordError } from "@/lib/error-log";

export async function GET(request: Request) {
  try {
    await query("SELECT 1");
    return Response.json({ status: "ok" });
  } catch (error) {
    await recordError({ error, statusCode: 503, request });
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
