import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro interno.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  if (message.includes("duplicate key")) return NextResponse.json({ error: "Login ou e-mail já cadastrado." }, { status: 409 });
  console.error(error);
  return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
}
