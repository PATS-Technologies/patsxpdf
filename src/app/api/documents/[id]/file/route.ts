import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";
import { serverTranslate } from "@/lib/i18n-server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser("pdfs-1");
    const { id } = await params;
    const result = await query<{ storage_name: string; original_name: string }>("SELECT storage_name,original_name FROM pdf_document WHERE id=$1", [id]);
    const document = result.rows[0];
    if (!document) return new Response(await serverTranslate("error.pdfNotFound"), { status: 404 });
    const storagePath = process.env.PDF_STORAGE ?? path.join(process.cwd(), "data", "pdfs");
    const bytes = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ storagePath, document.storage_name));
    return new Response(bytes, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.original_name)}` },
    });
  } catch (error) { return apiError(error); }
}
