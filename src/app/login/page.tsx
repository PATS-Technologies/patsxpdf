"use client";

import { FormEvent, useState } from "react";
import { KeyRound, LogIn, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { LocaleSwitcher, useI18n } from "@/components/I18nProvider";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupLogin, setSetupLogin] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: data.get("login"), password: data.get("password") }),
      });
      const result = await response.json().catch(() => null) as { error?: string; passwordSetupRequired?: boolean } | null;
      if (response.status === 409 && result?.passwordSetupRequired) {
        setSetupLogin(String(data.get("login") ?? ""));
        return;
      }
      if (!response.ok) {
        setError(result?.error ?? t("login.failed"));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("login.offline"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        {/* <div className="brand-mark"><FileText size={30} /></div> */ }
        <h1>Pats<span>XPDF</span></h1>
        <h3>&nbsp;Viewer</h3>
        <div className="brand-rule" />
        <p className="brand-copy">{t("login.tagline")}</p>
        <p className="login-footer">PATS Technologies</p>
      </section>
      <section className="login-panel">
        <LocaleSwitcher />
        <form className="login-form" onSubmit={submit}>
          <p className="eyebrow">{t("login.restricted")}</p>
          <h2>{t("login.title")}</h2>
          <label>{t("login.identifier")}<input name="login" autoComplete="username" autoFocus required /></label>
          <label>{t("login.password")}<input name="password" type="password" autoComplete="current-password" /></label>
          <a className="forgot-password" href="#" onClick={(event) => event.preventDefault()}>{t("login.forgot")}</a>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}><LogIn size={17} />{busy ? t("login.submitting") : t("login.submit")}</button>
        </form>
      </section>
      {setupLogin && <PasswordSetupDialog login={setupLogin} onClose={() => setSetupLogin(null)} />}
    </main>
  );
}

function PasswordSetupDialog({ login, onClose }: { login: string; onClose: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirmPassword")) return setError(t("admin.passwordMismatch"));
    setBusy(true);
    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, activationCode: data.get("activationCode"), password }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) return setError(result?.error ?? t("login.failed"));
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("login.offline"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop"><section className="modal password-setup-modal" role="dialog" aria-modal="true" aria-labelledby="password-setup-title"><header><h2 id="password-setup-title">{t("login.setupTitle")}</h2><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header><form className="password-setup-form" onSubmit={activate}><p>{t("login.setupDescription")}</p><label>{t("login.activationCode")}<input name="activationCode" autoComplete="one-time-code" autoFocus required /></label><label>{t("login.newPassword")}<input name="password" type="password" autoComplete="new-password" minLength={5} required /></label><label>{t("admin.confirmPassword")}<input name="confirmPassword" type="password" autoComplete="new-password" minLength={5} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={busy}><KeyRound size={17} />{busy ? t("login.activating") : t("login.activate")}</button></footer></form></section></div>;
}
