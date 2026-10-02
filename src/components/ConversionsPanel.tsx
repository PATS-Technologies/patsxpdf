"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { useI18n } from "@/components/I18nProvider";
import { TablePagination, useEscape, usePaginatedItems } from "@/components/TablePagination";

type ConversionStatus = "processing" | "ok" | "alert" | "error";

interface ConversionRecord {
  id: string;
  uploaded_at: string;
  original_name: string;
  source_size_bytes: string;
  status: ConversionStatus;
  details: string | null;
  user_login: string;
  user_name: string;
  document_id: string | null;
  page_count: number | null;
  size_bytes: string | null;
  document_uploaded_at: string | null;
  document_date: string | null;
}

export interface ConversionDocument {
  id: string;
  original_name: string;
  page_count: number;
  size_bytes: string;
  uploaded_at: string;
  document_date: string | null;
}

function DetailsDialog({ details, onClose }: { details: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEscape(onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return <dialog ref={dialogRef} className="modal conversion-details" aria-label={t("conversion.detailsTitle")} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2>{t("conversion.detailsTitle")}</h2><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header>
    <pre>{details}</pre>
  </dialog>;
}

export function ConversionsPanel({
  user,
  selectedId,
  onSelect,
  onOpen,
  onClose,
}: {
  user: SessionUser;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (document: ConversionDocument) => void;
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [conversions, setConversions] = useState<ConversionRecord[]>([]);
  const [details, setDetails] = useState<string | null>(null);
  const [error, setError] = useState("");
  const selectedIndex = conversions.findIndex((record) => record.id === selectedId);
  useEscape(onClose, true, true);
  const { page, pageCount, pageItems, setContainer, setPage } = usePaginatedItems({
    items: conversions,
    selectedIndex,
    onSelectIndex: (index) => onSelect(conversions[index].id),
  });

  const loadConversions = useCallback(async () => {
    const response = await fetch("/api/conversions");
    if (!response.ok) {
      const result = await response.json() as { error?: string };
      setError(result.error ?? t("conversion.loadFailed"));
      return;
    }
    const records = await response.json() as ConversionRecord[];
    setConversions(records);
    if (records.length && !records.some((record) => record.id === selectedId)) onSelect(records[0].id);
    setError("");
  }, [onSelect, selectedId, t]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadConversions(), 0);
    const interval = window.setInterval(() => void loadConversions(), 3000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadConversions]);

  function open(record: ConversionRecord) {
    if (!record.document_id || !record.page_count || !record.size_bytes || !record.document_uploaded_at) return;
    onOpen({
      id: record.document_id,
      original_name: record.original_name,
      page_count: record.page_count,
      size_bytes: record.size_bytes,
      uploaded_at: record.document_uploaded_at,
      document_date: record.document_date,
    });
  }

  return <div className="admin-page">
    <header><div><p className="eyebrow">{t("conversion.eyebrow")}</p><h1>{t("conversion.title")}</h1></div><button className="icon-button" title={t("common.close")} onClick={onClose}><X size={18} /></button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div ref={setContainer} className="table-scroll admin-table"><table><thead><tr>
      {user.isAdmin && <th>{t("conversion.user")}</th>}
      <th>{t("conversion.id")}</th>
      <th>{t("conversion.uploadedAt")}</th>
      <th>{t("conversion.file")}</th>
      <th>{t("conversion.status")}</th>
      <th>{t("conversion.view")}</th>
      <th>{t("conversion.message")}</th>
    </tr></thead><tbody>{pageItems.map((record) => {
      const canView = (record.status === "ok" || record.status === "alert") && Boolean(record.document_id);
      const summary = record.details?.split(/\r?\n/, 1)[0] ?? "";
      return <tr key={record.id} className={selectedId === record.id ? "selected" : ""} onClick={() => onSelect(record.id)}>
        {user.isAdmin && <td>{record.user_name} <small className="mono">({record.user_login})</small></td>}
        <td className="mono">{record.id}</td>
        <td>{formatDate(record.uploaded_at)}</td>
        <td>{record.original_name}</td>
        <td><span className={`status ${record.status === "ok" ? "ok" : record.status === "alert" ? "warning" : record.status === "error" ? "danger" : ""}`}>{t(`conversion.status.${record.status}`)}</span></td>
        <td><button className="conversion-view" disabled={!canView} title={t("conversion.view")} onClick={(event) => { event.stopPropagation(); open(record); }}><Eye size={15} />{t("conversion.view")}</button></td>
        <td>{summary ? <button className="conversion-message" onClick={(event) => { event.stopPropagation(); setDetails(record.details); }}>{summary}</button> : "-"}</td>
      </tr>;
    })}</tbody></table></div>
    <TablePagination page={page} pageCount={pageCount} onPageChange={setPage} />
    {details && <DetailsDialog details={details} onClose={() => setDetails(null)} />}
  </div>;
}
