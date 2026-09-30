"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, LockKeyhole, Pencil, Plus, RefreshCcw, Trash2, X } from "lucide-react";

interface Param { code: string; value: string; description: string; }
interface Role { id: number; name: string; description?: string; }
interface User { id: number; login: string; name: string; email: string; gender: "M" | "F"; locked: boolean; password_expired: boolean; roles: Role[]; }

export function ParametersPanel() {
  const [params, setParams] = useState<Param[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  useEffect(() => { fetch("/api/params").then((response) => response.ok ? response.json() : []).then(setParams); }, []);

  async function save(code: string) {
    const response = await fetch("/api/params", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, value }) });
    if (!response.ok) return alert((await response.json()).error);
    setParams((current) => current.map((item) => item.code === code ? { ...item, value } : item)); setEditing(null);
  }

  return <div className="admin-page"><header><div><p className="eyebrow">Configurações</p><h1>Parâmetros</h1></div></header><div className="table-scroll admin-table"><table><thead><tr><th>Parâmetro</th><th>Valor</th><th>Descrição</th><th /></tr></thead><tbody>{params.map((item) => <tr key={item.code}><td className="mono">{item.code}</td><td>{editing === item.code ? <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(item.code); }} /> : item.value}</td><td>{item.description}</td><td className="row-actions">{editing === item.code ? <><button title="Salvar" onClick={() => void save(item.code)}><Check size={16} /></button><button title="Cancelar" onClick={() => setEditing(null)}><X size={16} /></button></> : <button title="Editar" onClick={() => { setEditing(item.code); setValue(item.value ?? ""); }}><Pencil size={16} /></button>}</td></tr>)}</tbody></table></div></div>;
}

export function UsersPanel({ isAdmin }: { isAdmin: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const selected = users.find((item) => item.id === selectedId);

  async function refresh() {
    const [usersResponse, rolesResponse] = await Promise.all([fetch("/api/users"), fetch("/api/roles")]);
    if (usersResponse.ok) setUsers(await usersResponse.json());
    if (rolesResponse.ok) setRoles(await rolesResponse.json());
  }
  useEffect(() => { void Promise.all([fetch("/api/users").then((response) => response.json()).then(setUsers), fetch("/api/roles").then((response) => response.json()).then(setRoles)]); }, []);

  async function remove() {
    if (!selected || !confirm(`Excluir o usuário ${selected.login}?`)) return;
    const response = await fetch(`/api/users?id=${selected.id}`, { method: "DELETE" });
    if (!response.ok) return alert((await response.json()).error);
    setSelectedId(null); await refresh();
  }

  async function status(action: "toggle-lock" | "expire-password") {
    if (!selected) return;
    const response = await fetch(`/api/users/${selected.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!response.ok) return alert((await response.json()).error);
    await refresh();
  }

  return <div className="admin-page"><header><div><p className="eyebrow">Configurações</p><h1>Usuários</h1></div><div className="action-bar"><button onClick={() => setEditing("new")}><Plus size={15} />Novo</button><button disabled={!selected} onClick={() => selected && setEditing(selected)}><Pencil size={15} />Editar</button><button disabled={!selected} onClick={() => void remove()}><Trash2 size={15} />Excluir</button>{isAdmin && <><button disabled={!selected} onClick={() => void status("expire-password")}><RefreshCcw size={15} />Expirar senha</button><button disabled={!selected} onClick={() => void status("toggle-lock")}><LockKeyhole size={15} />Bloquear/Desbloquear</button></>}</div></header><div className="table-scroll admin-table"><table><thead><tr><th>Login</th><th>Nome</th><th>e-mail</th><th>Gênero</th><th>Papéis</th><th>Status</th></tr></thead><tbody>{users.map((item) => <tr key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)} onDoubleClick={() => setEditing(item)}><td className="mono">{item.login}</td><td>{item.name}</td><td>{item.email}</td><td>{item.gender === "M" ? "Masculino" : "Feminino"}</td><td>{item.roles.map((role) => role.name).join(", ")}</td><td><span className={`status ${item.locked ? "danger" : item.password_expired ? "warning" : "ok"}`}>{item.locked ? "Bloqueado" : item.password_expired ? "Senha expirada" : "Ativo"}</span></td></tr>)}</tbody></table></div>{editing && <UserDialog user={editing === "new" ? null : editing} roles={roles} isAdmin={isAdmin} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />}</div>;
}

function UserDialog({ user, roles, isAdmin, onClose, onSaved }: { user: User | null; roles: Role[]; isAdmin: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [roleIds, setRoleIds] = useState<number[]>(user?.roles.map((role) => role.id) ?? []);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password && password !== form.get("confirmPassword")) return setError("A confirmação da senha não confere.");
    const payload = { id: user?.id, login: form.get("login"), name: form.get("name"), email: form.get("email"), gender: form.get("gender"), roleIds, ...(password ? { password } : {}) };
    const response = await fetch("/api/users", { method: user ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) return setError((await response.json()).error ?? "Não foi possível salvar.");
    await onSaved();
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal user-modal" onMouseDown={(event) => event.stopPropagation()}><header><h2>{user ? "Editar usuário" : "Novo usuário"}</h2><button className="icon-button" onClick={onClose}><X size={18} /></button></header><form onSubmit={submit} className="user-form"><div className="form-grid"><label>Login<input name="login" defaultValue={user?.login} readOnly={!!user} required /></label><label>Nome<input name="name" defaultValue={user?.name} required /></label><label>e-mail<input name="email" type="email" defaultValue={user?.email} required /></label><label>Gênero<select name="gender" defaultValue={user?.gender ?? "M"}><option value="M">Masculino</option><option value="F">Feminino</option></select></label>{user && isAdmin && <><label>Senha<input name="password" type="password" minLength={5} /></label><label>Confirmar senha<input name="confirmPassword" type="password" minLength={5} /></label></>}</div><fieldset><legend>Papéis</legend>{roles.map((role) => <label className="check-row" key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => setRoleIds((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id])} /> <span><strong>{role.name}</strong><small>{role.description}</small></span></label>)}</fieldset>{error && <p className="form-error">{error}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!roleIds.length}>Salvar</button></footer></form></section></div>;
}
