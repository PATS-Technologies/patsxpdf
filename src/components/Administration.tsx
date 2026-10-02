"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, LockKeyhole, Pencil, Plus, RefreshCcw, Trash2, X } from "lucide-react";
import { getUserInitials } from "@/lib/user-initials";
import { useI18n } from "@/components/I18nProvider";
import { locales, type Locale, type TranslationKey } from "@/lib/i18n";

interface Param { code: string; value: string; description: string; }
interface Role { id: number; name: string; description?: string; }
interface User { id: number; login: string; name: string; initials: string; email: string; gender: "M" | "F" | null; preferred_locale: Locale; locked: boolean; password_expired: boolean; roles: Role[]; }
interface ActivationDetails { code: string; expiresAt: string; }

function ActivationDialog({ activation, onClose }: { activation: ActivationDetails; onClose: () => void }) {
  const { formatDate, t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyCode() {
    await navigator.clipboard.writeText(activation.code);
    setCopied(true);
  }

  return <div className="modal-backdrop"><section className="modal activation-modal" role="dialog" aria-modal="true" aria-labelledby="activation-title"><header><h2 id="activation-title">{t("admin.activationTitle")}</h2><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header><div className="activation-content"><p>{t("admin.activationDescription")}</p><code>{activation.code}</code><p>{t("admin.activationExpires", { date: formatDate(activation.expiresAt) })}</p><button className="primary-button" onClick={() => void copyCode()}>{t("admin.copyActivation")}</button></div></section>{copied && <div className="activation-toast" role="status" aria-live="polite"><Check size={17} />{t("admin.activationCopied")}</div>}</div>;
}

export function ParametersPanel() {
  const { t } = useI18n();
  const [params, setParams] = useState<Param[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  useEffect(() => { fetch("/api/params").then((response) => response.ok ? response.json() : []).then(setParams); }, []);

  async function save(code: string) {
    const response = await fetch("/api/params", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, value }) });
    if (!response.ok) return alert((await response.json()).error);
    setParams((current) => current.map((item) => item.code === code ? { ...item, value } : item)); setEditing(null);
  }

  return <div className="admin-page"><header><div><p className="eyebrow">{t("common.settings")}</p><h1>{t("menu.parameters")}</h1></div></header><div className="table-scroll admin-table"><table><thead><tr><th>{t("admin.parameter")}</th><th>{t("admin.value")}</th><th>{t("admin.description")}</th><th /></tr></thead><tbody>{params.map((item) => <tr key={item.code}><td className="mono">{item.code}</td><td>{editing === item.code ? <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(item.code); }} /> : item.value}</td><td>{item.description}</td><td className="row-actions">{editing === item.code ? <><button title={t("common.save")} onClick={() => void save(item.code)}><Check size={16} /></button><button title={t("common.cancel")} onClick={() => setEditing(null)}><X size={16} /></button></> : <button title={t("common.edit")} onClick={() => { setEditing(item.code); setValue(item.value ?? ""); }}><Pencil size={16} /></button>}</td></tr>)}</tbody></table></div></div>;
}

export function UsersPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [activation, setActivation] = useState<ActivationDetails | null>(null);
  const selected = users.find((item) => item.id === selectedId);

  async function refresh() {
    const [usersResponse, rolesResponse] = await Promise.all([fetch("/api/users"), fetch("/api/roles")]);
    if (usersResponse.ok) setUsers(await usersResponse.json());
    if (rolesResponse.ok) setRoles(await rolesResponse.json());
  }
  useEffect(() => { void Promise.all([fetch("/api/users").then((response) => response.json()).then(setUsers), fetch("/api/roles").then((response) => response.json()).then(setRoles)]); }, []);

  async function remove() {
    if (!selected || !confirm(t("admin.confirmDelete", { login: selected.login }))) return;
    const response = await fetch(`/api/users?id=${selected.id}`, { method: "DELETE" });
    if (!response.ok) return alert((await response.json()).error);
    setSelectedId(null); await refresh();
  }

  async function status(action: "toggle-lock" | "expire-password") {
    if (!selected) return;
    const response = await fetch(`/api/users/${selected.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!response.ok) return alert((await response.json()).error);
    const result = await response.json() as { activationCode?: string; activationExpiresAt?: string };
    if (result.activationCode && result.activationExpiresAt) setActivation({ code: result.activationCode, expiresAt: result.activationExpiresAt });
    await refresh();
  }

  return <div className="admin-page"><header><div><p className="eyebrow">{t("common.settings")}</p><h1>{t("menu.users")}</h1></div><div className="action-bar"><button onClick={() => setEditing("new")}><Plus size={15} />{t("admin.new")}</button><button disabled={!selected} onClick={() => selected && setEditing(selected)}><Pencil size={15} />{t("common.edit")}</button><button disabled={!selected} onClick={() => void remove()}><Trash2 size={15} />{t("common.delete")}</button>{isAdmin && <><button disabled={!selected} onClick={() => void status("expire-password")}><RefreshCcw size={15} />{t("admin.expirePassword")}</button><button disabled={!selected} onClick={() => void status("toggle-lock")}><LockKeyhole size={15} />{t("admin.toggleLock")}</button></>}</div></header><div className="table-scroll admin-table"><table><thead><tr><th>{t("admin.login")}</th><th>{t("admin.name")}</th><th>{t("admin.email")}</th><th>{t("admin.gender")}</th><th>{t("admin.roles")}</th><th>{t("admin.status")}</th></tr></thead><tbody>{users.map((item) => <tr key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)} onDoubleClick={() => setEditing(item)}><td className="mono">{item.login}</td><td>{item.name}</td><td>{item.email}</td><td>{item.gender === "M" ? t("admin.male") : item.gender === "F" ? t("admin.female") : t("admin.notInformed")}</td><td>{item.roles.map((role) => role.name).join(", ")}</td><td><span className={`status ${item.locked ? "danger" : item.password_expired ? "warning" : "ok"}`}>{item.locked ? t("admin.locked") : item.password_expired ? t("admin.passwordExpired") : t("admin.active")}</span></td></tr>)}</tbody></table></div>{editing && <UserDialog user={editing === "new" ? null : editing} roles={roles} onClose={() => setEditing(null)} onSaved={async (_, nextActivation) => { setEditing(null); if (nextActivation) setActivation(nextActivation); await refresh(); }} />}{activation && <ActivationDialog activation={activation} onClose={() => setActivation(null)} />}</div>;
}

export function UserProfileDialog({ onClose }: { onClose: () => void }) {
  const { setLocale, t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/users/me").then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error ?? t("admin.saveFailed"));
      return response.json();
    }).then((data) => { if (active) setUser(data); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t("admin.saveFailed")); });
    return () => { active = false; };
  }, [t]);

  if (error) return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal user-modal" onMouseDown={(event) => event.stopPropagation()}><header><h2>{t("menu.profile")}</h2><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header><p className="form-error">{error}</p></section></div>;
  if (!user) return null;
  return <UserDialog user={user} roles={user.roles} self endpoint="/api/users/me" onClose={onClose} onSaved={async (preferredLocale) => { await setLocale(preferredLocale, false); onClose(); }} />;
}

function UserDialog({ user, roles, self = false, endpoint = "/api/users", onClose, onSaved }: { user: User | null; roles: Role[]; self?: boolean; endpoint?: string; onClose: () => void; onSaved: (preferredLocale: Locale, activation?: ActivationDetails) => Promise<void> }) {
  const { locale, t } = useI18n();
  const [roleIds, setRoleIds] = useState<number[]>(user?.roles.map((role) => role.id) ?? []);
  const [name, setName] = useState(user?.name ?? "");
  const [initials, setInitials] = useState(user?.initials ?? "");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password && password !== form.get("confirmPassword")) return setError(t("admin.passwordMismatch"));
    const gender = String(form.get("gender") ?? "");
    const preferredLocale = form.get("preferredLocale") as Locale;
    const profile = { name, initials, email: form.get("email"), gender: gender || null, preferredLocale, ...(password ? { password } : {}) };
    const payload = self ? profile : { id: user?.id, login: form.get("login"), ...profile, roleIds };
    const response = await fetch(endpoint, { method: user ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) return setError((await response.json()).error ?? t("admin.saveFailed"));
    const result = await response.json() as { activationCode?: string; activationExpiresAt?: string };
    const activation = result.activationCode && result.activationExpiresAt ? { code: result.activationCode, expiresAt: result.activationExpiresAt } : undefined;
    await onSaved(preferredLocale, activation);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal user-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{user ? t("admin.editUser") : t("admin.newUser")}</h2>
          <button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button>
        </header>
        <form onSubmit={submit} className="user-form">
          <div className="form-grid">
            <label>{t("admin.login")+"*"}
              <input name="login" defaultValue={user?.login} readOnly={!!user} required style={{ backgroundColor: !!user ? "#f0f0f0" : "inherit" }}/>
            </label>
            <label>{t("admin.name")+"*"}
              <input name="name" value={name} onChange={(event) => { const nextName = event.target.value; setName(nextName); setInitials(getUserInitials(nextName)); }} required />
            </label>
            <label>{t("admin.initials")+"*"}
              <input name="initials" value={initials} maxLength={3} onChange={(event) => setInitials(event.target.value.toLocaleUpperCase(locale).slice(0, 3))} required />
            </label>
            <label>{t("admin.email")+"*"}
              <input name="email" type="email" defaultValue={user?.email} required />
            </label>
            <label>{t("admin.gender")}
              <select name="gender" defaultValue={user?.gender ?? ""}>
                <option value="">{t("admin.notInformed")}</option>
                <option value="M">{t("admin.male")}</option>
                <option value="F">{t("admin.female")}</option>
              </select>
            </label>
            <label>{t("admin.preferredLanguage")+"*"}
              <select name="preferredLocale" defaultValue={user?.preferred_locale ?? locale}>
                {locales.map((item) => <option key={item} value={item}>{t(`language.${item}` as TranslationKey)}</option>)}
              </select>
            </label>
            {user && self && <>
              <label>{t("login.password")}
                <input name="password" type="password" minLength={5} />
              </label>
              <label>{t("admin.confirmPassword")}
                <input name="confirmPassword" type="password" minLength={5} />
              </label>
            </>}
          </div>
          <fieldset>
            <legend>{t("admin.roles")}</legend>
            {roles.map((role) =>
              <label className="check-row" key={role.id}>
                <input type="checkbox" disabled={self} checked={roleIds.includes(role.id)} onChange={() => setRoleIds((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id])} />
                <span><strong>{role.name}</strong><small>{role.description}</small></span>
            </label>)}
          </fieldset>
          {error && <p className="form-error">{error}</p>}
          <footer>
            <button type="button" className="secondary-button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" disabled={!self && !roleIds.length}>{t("common.save")}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
