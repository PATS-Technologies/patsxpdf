"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { useI18n } from "@/components/I18nProvider";
import { TablePagination, useEscape, usePaginatedItems } from "@/components/TablePagination";

type ExtractionStatus = "queued" | "processing" | "completed" | "error";

interface ExtractionTask {
  id: string;
  display_id: string;
  user_login: string;
  user_name: string;
  original_name: string;
  requested_pages: number[];
  languages: string[];
  status: ExtractionStatus;
  total_pages: number;
  processed_pages: number;
  used_ocr: boolean | null;
  error: string | null;
  created_at: string;
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

function summarizePages(pages: number[]) {
  if (pages.length <= 6) return pages.join(", ");
  return `${pages.slice(0, 3).join(", ")}, ..., ${pages.slice(-3).join(", ")}`;
}

function ResultDialog({ task, onClose }: { task: ExtractionTask; onClose: () => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"text" | "json">("text");
  const [error, setError] = useState("");
  useEscape(onClose);

  useEffect(() => {
    dialogRef.current?.showModal();
    void fetch(`/api/extractions/${task.id}/text`).then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response, t("ocrQueue.downloadFailed")));
      setText(await response.text());
    }).catch((reason) => setError(reason instanceof Error ? reason.message : t("ocrQueue.downloadFailed")));
  }, [task.id, t]);

  function download() {
    const anchor = document.createElement("a");
    anchor.href = `/api/extractions/${task.id}/${format}`;
    anchor.download = `${task.original_name}.${format === "text" ? "txt" : "json"}`;
    anchor.click();
  }

  return <dialog ref={dialogRef} className="modal modal-wide" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2>{t("extract.resultTitle")}</h2><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header>
    <div className="extraction-result">
      <strong>{task.original_name}</strong>
      {error ? <p className="form-error">{error}</p> : <textarea readOnly value={text} />}
      <fieldset className="extraction-formats"><legend>{t("extract.downloadFormat")}</legend>
        <label><input type="radio" checked={format === "text"} onChange={() => setFormat("text")} />{t("extract.formatText")}</label>
        <label><input type="radio" checked={format === "json"} onChange={() => setFormat("json")} />{t("extract.formatJson")}</label>
      </fieldset>
      <div className="dialog-actions"><button onClick={onClose}>{t("common.close")}</button><button className="primary-button" disabled={Boolean(error)} onClick={download}>{t("common.download")}</button></div>
    </div>
  </dialog>;
}

export function OcrQueuePanel({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const { formatDate, t } = useI18n();
  const [tasks, setTasks] = useState<ExtractionTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resultTask, setResultTask] = useState<ExtractionTask | null>(null);
  const [idQuery, setIdQuery] = useState("");
  const [error, setError] = useState("");
  const filteredTasks = tasks.filter((task) => task.display_id.includes(idQuery.trim()) || task.display_id.replaceAll(".", "").includes(idQuery.replaceAll(".", "").trim()));
  const selectedIndex = filteredTasks.findIndex((task) => task.id === selectedId);
  useEscape(onClose, !resultTask, true);
  const { page, pageCount, pageItems, setContainer, setPage } = usePaginatedItems({
    items: filteredTasks,
    selectedIndex,
    onSelectIndex: (index) => setSelectedId(filteredTasks[index].id),
  });

  const loadTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/extractions");
      if (!response.ok) throw new Error(await responseError(response, t("ocrQueue.loadFailed")));
      const listed = await response.json() as ExtractionTask[];
      const refreshed = await Promise.all(listed.map(async (task) => {
        if (task.status === "completed" || task.status === "error") return task;
        const statusResponse = await fetch(`/api/extractions/${task.id}`);
        return statusResponse.ok ? { ...task, ...await statusResponse.json() as ExtractionTask } : task;
      }));
      setTasks(refreshed);
      setSelectedId((current) => current && refreshed.some((task) => task.id === current) ? current : refreshed[0]?.id ?? null);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("ocrQueue.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadTasks(), 0);
    const interval = window.setInterval(() => void loadTasks(), 3000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadTasks]);

  return <div className="admin-page">
    <header>
      <div><p className="eyebrow">{t("menu.extract")}</p><h1>{t("ocrQueue.title")}</h1></div>
      <button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button>
    </header>
    <div className="queue-filter"><label>{t("ocrQueue.searchId")}<input value={idQuery} onChange={(event) => setIdQuery(event.target.value)} placeholder="999.999.999.999" /></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div ref={setContainer} className="table-scroll admin-table"><table><thead><tr>
      <th>{t("ocrQueue.id")}</th>
      {user.isAdmin && <th>{t("ocrQueue.user")}</th>}
      <th>{t("ocrQueue.createdAt")}</th>
      <th>{t("ocrQueue.file")}</th>
      <th>{t("ocrQueue.pages")}</th>
      <th>{t("ocrQueue.ocrUsed")}</th>
      <th>{t("ocrQueue.status")}</th>
      <th>{t("ocrQueue.progress")}</th>
      <th>{t("ocrQueue.results")}</th>
      <th>{t("ocrQueue.error")}</th>
    </tr></thead><tbody>{pageItems.map((task) => {
      const completed = task.status === "completed";
      return <tr key={task.id} className={selectedId === task.id ? "selected" : ""} onClick={() => setSelectedId(task.id)}>
        <td className="mono">{task.display_id}</td>
        {user.isAdmin && <td>{task.user_name} <small className="mono">({task.user_login})</small></td>}
        <td>{formatDate(task.created_at)}</td>
        <td>{task.original_name}</td>
        <td className="extraction-pages" title={task.requested_pages.join(", ")}>{summarizePages(task.requested_pages)}</td>
        <td>{task.used_ocr === null ? "-" : task.used_ocr ? t("common.yes") : t("common.no")}</td>
        <td><span className={`status ${completed ? "ok" : task.status === "error" ? "danger" : ""}`}>{t(`ocrQueue.status.${task.status}`)}</span></td>
        <td>{task.processed_pages}/{task.total_pages}</td>
        <td><button className="view-result-button" disabled={!completed} onClick={(event) => { event.stopPropagation(); setResultTask(task); }}><Eye size={15} />{t("ocrQueue.viewResult")}</button></td>
        <td>{task.error ?? "-"}</td>
      </tr>;
    })}</tbody></table></div>
    <TablePagination page={page} pageCount={pageCount} onPageChange={setPage} />
    {resultTask && <ResultDialog task={resultTask} onClose={() => setResultTask(null)} />}
  </div>;
}
