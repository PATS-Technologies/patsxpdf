"use client";

import { FormEvent, useEffect, useState } from "react";
import { Download, Eye, RefreshCcw, Search, X } from "lucide-react";
import { useEscape } from "@/components/TablePagination";
import { useI18n } from "@/components/I18nProvider";
import { downloadCsv } from "@/lib/csv";

interface ErrorLogEntry {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_login: string | null;
  route: string;
  method: string;
  status_code: number;
  error_name: string;
  message: string;
  stack: string | null;
  request_id: string;
  ip_address: string | null;
  user_agent: string | null;
  filename: string | null;
  details: Record<string, unknown>;
}

interface ErrorFilters {
  statusCode: string;
  query: string;
}

const pageSize = 100;

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

function ErrorDetails({ entry, onClose }: { entry: ErrorLogEntry; onClose: () => void }) {
  const { formatDate, t } = useI18n();
  useEscape(onClose);

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal audit-details error-details" role="dialog" aria-modal="true" aria-labelledby="error-details-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2 id="error-details-title">{t("errorLog.details")}</h2><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header>
      <dl>
        <div><dt>{t("errorLog.date")}</dt><dd>{formatDate(entry.occurred_at)}</dd></div>
        <div><dt>{t("errorLog.status")}</dt><dd>{entry.status_code}</dd></div>
        <div><dt>{t("errorLog.actor")}</dt><dd>{entry.actor_login ?? t("audit.systemActor")}</dd></div>
        <div><dt>{t("errorLog.filename")}</dt><dd>{entry.filename ?? "-"}</dd></div>
        <div><dt>{t("errorLog.route")}</dt><dd className="mono">{entry.method} {entry.route}</dd></div>
        <div><dt>{t("errorLog.errorType")}</dt><dd className="mono">{entry.error_name}</dd></div>
        <div><dt>{t("audit.requestId")}</dt><dd className="mono">{entry.request_id}</dd></div>
        <div><dt>{t("audit.ipAddress")}</dt><dd className="mono">{entry.ip_address ?? "-"}</dd></div>
        <div><dt>{t("audit.userAgent")}</dt><dd>{entry.user_agent ?? "-"}</dd></div>
      </dl>
      <h3>{t("errorLog.message")}</h3><pre>{entry.message}</pre>
      {entry.stack && <><h3>{t("errorLog.stack")}</h3><pre>{entry.stack}</pre></>}
      <h3>{t("audit.eventData")}</h3><pre>{JSON.stringify(entry.details, null, 2)}</pre>
    </section>
  </div>;
}

export function ErrorLogPanel({ onClose }: { onClose: () => void }) {
  const { formatDate, t } = useI18n();
  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);
  const [statusCode, setStatusCode] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<ErrorLogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  useEscape(onClose, !details, true);

  useEffect(() => {
    let active = true;
    fetch(`/api/errors?limit=${pageSize}`).then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response, t("errorLog.loadFailed")));
      return response.json() as Promise<ErrorLogEntry[]>;
    }).then((items) => {
      if (!active) return;
      setEntries(items);
      setSelectedId(items[0]?.id ?? null);
      setHasMore(items.length === pageSize);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : t("errorLog.loadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [t]);

  async function loadEntries(reset: boolean, filters: ErrorFilters = { statusCode, query }) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (filters.statusCode) params.set("statusCode", filters.statusCode);
    if (filters.query.trim()) params.set("query", filters.query.trim());
    if (!reset && entries.length) params.set("before", entries[entries.length - 1].id);
    try {
      const response = await fetch(`/api/errors?${params}`);
      if (!response.ok) throw new Error(await responseError(response, t("errorLog.loadFailed")));
      const items = await response.json() as ErrorLogEntry[];
      setEntries((current) => reset ? items : [...current, ...items]);
      setSelectedId((current) => reset ? items[0]?.id ?? null : current ?? items[0]?.id ?? null);
      setHasMore(items.length === pageSize);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorLog.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadEntries(true);
  }

  function clearFilters() {
    setStatusCode("");
    setQuery("");
    void loadEntries(true, { statusCode: "", query: "" });
  }

  function exportCsv() {
    downloadCsv(`error-log-${new Date().toISOString().slice(0, 10)}.csv`, [
      t("errorLog.date"), t("errorLog.status"), t("errorLog.actor"), t("errorLog.filename"),
      t("errorLog.route"), t("errorLog.errorType"), t("errorLog.message"), t("audit.requestId"),
      t("audit.ipAddress"), t("audit.userAgent"), t("errorLog.stack"), t("audit.eventData"),
    ], entries.map((entry) => [
      formatDate(entry.occurred_at), entry.status_code, entry.actor_login ?? t("audit.systemActor"), entry.filename,
      `${entry.method} ${entry.route}`, entry.error_name, entry.message, entry.request_id,
      entry.ip_address, entry.user_agent, entry.stack, entry.details,
    ]));
  }

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  return <div className="admin-page audit-page">
    <header>
      <div><p className="eyebrow">{t("common.settings")}</p><h1>{t("errorLog.title")}</h1></div>
      <div className="action-bar">
        <button disabled={loading} onClick={() => void loadEntries(true)}><RefreshCcw size={15} />{t("audit.refresh")}</button>
        <button disabled={!entries.length} onClick={exportCsv}><Download size={15} />{t("logs.exportCsv")}</button>
        <button disabled={!selected} onClick={() => selected && setDetails(selected)}><Eye size={15} />{t("errorLog.details")}</button>
        <button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button>
      </div>
    </header>
    <form className="audit-filters" onSubmit={applyFilters}>
      <label>{t("errorLog.status")}<select value={statusCode} onChange={(event) => setStatusCode(event.target.value)}><option value="">{t("errorLog.allStatuses")}</option>{[400, 401, 403, 404, 409, 413, 422, 500, 502, 503].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
      <label>{t("common.search")}<input value={query} maxLength={200} placeholder={t("errorLog.searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={loading}><Search size={15} />{t("audit.filter")}</button>
      <button type="button" disabled={loading || (!statusCode && !query)} onClick={clearFilters}>{t("audit.clearFilters")}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="table-scroll admin-table audit-table">
      <table><thead><tr><th>{t("errorLog.date")}</th><th>{t("errorLog.status")}</th><th>{t("errorLog.filename")}</th><th>{t("errorLog.actor")}</th><th>{t("errorLog.route")}</th><th>{t("errorLog.message")}</th><th>{t("audit.ipAddress")}</th></tr></thead>
        <tbody>
          {entries.map((entry) => <tr key={entry.id} className={selectedId === entry.id ? "selected" : ""} onClick={() => setSelectedId(entry.id)} onDoubleClick={() => setDetails(entry)}>
            <td>{formatDate(entry.occurred_at)}</td><td><span className="status danger">{entry.status_code}</span></td><td>{entry.filename ?? "-"}</td><td>{entry.actor_login ?? t("audit.systemActor")}</td><td className="mono">{entry.method} {entry.route}</td><td className="error-message-cell">{entry.message}</td><td className="mono">{entry.ip_address ?? "-"}</td>
          </tr>)}
          {!entries.length && !loading && <tr><td colSpan={7} className="table-empty">{t("errorLog.noEvents")}</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="audit-footer"><span>{loading ? t("audit.loading") : t("errorLog.loadedCount", { count: entries.length })}</span><button disabled={loading || !hasMore} onClick={() => void loadEntries(false)}>{t("audit.loadMore")}</button></div>
    {details && <ErrorDetails entry={details} onClose={() => setDetails(null)} />}
  </div>;
}
