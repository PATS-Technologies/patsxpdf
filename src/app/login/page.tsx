"use client";

import { FormEvent, useState } from "react";
import { FileText, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: data.get("login"), password: data.get("password") }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Não foi possível entrar.");
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        {/* <div className="brand-mark"><FileText size={30} /></div> */ }
        <h1>Pats<span>XPDF</span></h1>
        <h3>&nbsp;Viewer</h3>
        <div className="brand-rule" />
        <p className="brand-copy">Leitura, pesquisa e revisão de documentos em um espaço de trabalho seguro.</p>
        <p className="login-footer">PATS Technologies</p>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <p className="eyebrow">Acesso restrito</p>
          <h2>Entrar no visualizador</h2>
          <label>Login ou e-mail<input name="login" autoComplete="username" autoFocus required /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}><LogIn size={17} />{busy ? "Entrando..." : "Entrar"}</button>
        </form>
      </section>
    </main>
  );
}
