import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, validateCredentials } from "@/lib/auth";

const credentialsSchema = z.object({ login: z.string().trim().min(1), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = credentialsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Informe login e senha." }, { status: 400 });
  const user = await validateCredentials(parsed.data.login, parsed.data.password);
  if (!user) return NextResponse.json({ error: "Credenciais inválidas ou usuário bloqueado." }, { status: 401 });
  await createSession(user.id);
  return NextResponse.json({ user });
}
