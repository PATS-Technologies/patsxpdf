import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { serverTranslate } from "@/lib/i18n-server";

export async function apiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: await serverTranslate("error.invalidData") }, { status: 400 });
  const message = error instanceof Error ? error.message : "Erro interno.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: await serverTranslate("error.invalidSession") }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: await serverTranslate("error.accessDenied") }, { status: 403 });
  if (message.includes("duplicate key")) return NextResponse.json({ error: await serverTranslate("error.duplicateUser") }, { status: 409 });
  console.error(error);
  return NextResponse.json({ error: await serverTranslate("error.internal") }, { status: 500 });
}
