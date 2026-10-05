"use client";

import { FormEvent, useEffect, useState } from "react";
import { Download, Eye, RefreshCcw, Search, X } from "lucide-react";
import { useEscape } from "@/components/TablePagination";
import { useI18n } from "@/components/I18nProvider";
import { downloadCsv } from "@/lib/csv";

interface AuditEvent {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_login: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  filename: string | null;
  outcome: "success" | "failure";
  request_id: string;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown>;
}

interface AuditUser {
  id: number;
  login: string;
  name: string;
}

interface AuditFilters {
  actorId: string;
  resourceType: string;
}

const pageSize = 100;

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

function AuditDetails({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  const { formatDate, t } = useI18n();
  useEscape(onClose);

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal audit-details" role="dialog" aria-modal="true" aria-labelledby="audit-details-title" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
      <header><h2 id="audit-details-title">{t("audit.details")}</h2><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header>
      <dl>
        <div><dt>{t("audit.date")}</dt><dd>{formatDate(event.occurred_at)}</dd></div>
        <div><dt>{t("audit.actor")}</dt><dd>{event.actor_login ?? t("audit.systemActor")}</dd></div>
        <div><dt>{t("audit.action")}</dt><dd className="mono">{event.action}</dd></div>
        <div><dt>{t("audit.filename")}</dt><dd>{event.filename ?? "-"}</dd></div>
        <div><dt>{t("audit.resource")}</dt><dd className="mono">{event.resource_type}{event.resource_id ? ` / ${event.resource_id}` : ""}</dd></div>
        <div><dt>{t("audit.outcome")}</dt><dd>{t(event.outcome === "success" ? "audit.success" : "audit.failure")}</dd></div>
        <div><dt>{t("audit.requestId")}</dt><dd className="mono">{event.request_id}</dd></div>
        <div><dt>{t("audit.ipAddress")}</dt><dd className="mono">{event.ip_address ?? "-"}</dd></div>
        <div><dt>{t("audit.userAgent")}</dt><dd>{event.user_agent ?? "-"}</dd></div>
      </dl>
      <h3>{t("audit.eventData")}</h3>
      <pre>{JSON.stringify(event.details, null, 2)}</pre>
    </section>
  </div>;
}

export function AuditPanel({ onClose }: { onClose: () => void }) {
  const { formatDate, t } = useI18n();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [users, setUsers] = useState<AuditUser[]>([]);
  const [actorId, setActorId] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<AuditEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  useEscape(onClose, !details, true);

  useEffect(() => {
    let active = true;
    void Promise.all([fetch(`/api/audit?limit=${pageSize}`), fetch("/api/users")]).then(async ([auditResponse, usersResponse]) => {
      if (!auditResponse.ok) throw new Error(await responseError(auditResponse, t("audit.loadFailed")));
      if (!usersResponse.ok) throw new Error(await responseError(usersResponse, t("audit.loadFailed")));
      const [auditEvents, auditUsers] = await Promise.all([
        auditResponse.json() as Promise<AuditEvent[]>,
        usersResponse.json() as Promise<AuditUser[]>,
      ]);
      if (!active) return;
      setEvents(auditEvents);
      setUsers(auditUsers);
      setSelectedId(auditEvents[0]?.id ?? null);
      setHasMore(auditEvents.length === pageSize);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : t("audit.loadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [t]);

  async function loadEvents(reset: boolean, filters: AuditFilters = { actorId, resourceType }) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (filters.actorId) params.set("actorId", filters.actorId);
    if (filters.resourceType.trim()) params.set("resourceType", filters.resourceType.trim());
    if (!reset && events.length) params.set("before", events[events.length - 1].id);
    try {
      const response = await fetch(`/api/audit?${params}`);
      if (!response.ok) throw new Error(await responseError(response, t("audit.loadFailed")));
      const items = await response.json() as AuditEvent[];
      setEvents((current) => reset ? items : [...current, ...items]);
      setSelectedId((current) => reset ? items[0]?.id ?? null : current ?? items[0]?.id ?? null);
      setHasMore(items.length === pageSize);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("audit.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadEvents(true);
  }

  function clearFilters() {
    const emptyFilters = { actorId: "", resourceType: "" };
    setActorId("");
    setResourceType("");
    void loadEvents(true, emptyFilters);
  }

  function exportCsv() {
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, [
      t("audit.date"), t("audit.filename"), t("audit.actor"), t("audit.action"), t("audit.resource"),
      t("audit.outcome"), t("audit.requestId"), t("audit.ipAddress"), t("audit.userAgent"), t("audit.eventData"),
    ], events.map((event) => [
      formatDate(event.occurred_at), event.filename, event.actor_login ?? t("audit.systemActor"), event.action,
      `${event.resource_type}${event.resource_id ? ` / ${event.resource_id}` : ""}`,
      t(event.outcome === "success" ? "audit.success" : "audit.failure"), event.request_id,
      event.ip_address, event.user_agent, event.details,
    ]));
  }

  const selected = events.find((event) => event.id === selectedId) ?? null;

  return <div className="admin-page audit-page">
    <header>
      <div><p className="eyebrow">{t("common.settings")}</p><h1>{t("audit.title")}</h1></div>
      <div className="action-bar">
        <button disabled={loading} onClick={() => void loadEvents(true)}><RefreshCcw size={15} />{t("audit.refresh")}</button>
        <button disabled={!events.length} onClick={exportCsv}><Download size={15} />{t("logs.exportCsv")}</button>
        <button disabled={!selected} onClick={() => selected && setDetails(selected)}><Eye size={15} />{t("audit.details")}</button>
        <button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button>
      </div>
    </header>
    <form className="audit-filters" onSubmit={applyFilters}>
      <label>{t("audit.actor")}<select value={actorId} onChange={(event) => setActorId(event.target.value)}><option value="">{t("audit.allActors")}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.login} - {user.name}</option>)}</select></label>
      <label>{t("audit.resourceType")}<input value={resourceType} maxLength={80} placeholder={t("audit.resourcePlaceholder")} onChange={(event) => setResourceType(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={loading}><Search size={15} />{t("audit.filter")}</button>
      <button type="button" disabled={loading || (!actorId && !resourceType)} onClick={clearFilters}>{t("audit.clearFilters")}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="table-scroll admin-table audit-table">
      <table>
        <thead><tr><th>{t("audit.date")}</th><th>{t("audit.filename")}</th><th>{t("audit.actor")}</th><th>{t("audit.action")}</th><th>{t("audit.resource")}</th><th>{t("audit.outcome")}</th><th>{t("audit.ipAddress")}</th></tr></thead>
        <tbody>
          {events.map((event) => <tr key={event.id} className={selectedId === event.id ? "selected" : ""} onClick={() => setSelectedId(event.id)} onDoubleClick={() => setDetails(event)}>
            <td>{formatDate(event.occurred_at)}</td><td>{event.filename ?? "-"}</td><td>{event.actor_login ?? t("audit.systemActor")}</td><td className="mono">{event.action}</td><td className="mono">{event.resource_type}{event.resource_id ? ` / ${event.resource_id}` : ""}</td><td><span className={`status ${event.outcome === "success" ? "ok" : "danger"}`}>{t(event.outcome === "success" ? "audit.success" : "audit.failure")}</span></td><td className="mono">{event.ip_address ?? "-"}</td>
          </tr>)}
          {!events.length && !loading && <tr><td colSpan={7} className="table-empty">{t("audit.noEvents")}</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="audit-footer"><span>{loading ? t("audit.loading") : t("audit.loadedCount", { count: events.length })}</span><button disabled={loading || !hasMore} onClick={() => void loadEvents(false)}>{t("audit.loadMore")}</button></div>
    {details && <AuditDetails event={details} onClose={() => setDetails(null)} />}
  </div>;
}
