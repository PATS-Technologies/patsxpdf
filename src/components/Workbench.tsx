"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, DragEvent, FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine,
  CheckCircle2, ChevronDown, Circle,
  FilePlus2, FolderOpen,
  Highlighter,
  LoaderCircle,
  LogOut, LucideFile,
  ListChecks, MessageSquareText, MoveHorizontal, MoveVertical,
  Pencil, Play, Plus,
  RectangleHorizontal, RotateCcw, RotateCw,
  Search, StepBack, StepForward,
  UserRound,
  X,
  ZoomIn, ZoomOut } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { SearchOptions } from "@/components/PdfViewer";
import { ParametersPanel, UserProfileDialog, UsersPanel } from "@/components/Administration";
import { AuditPanel } from "@/components/AuditPanel";
import { ErrorLogPanel } from "@/components/ErrorLogPanel";
import { ConversionsPanel } from "@/components/ConversionsPanel";
import { OcrQueuePanel } from "@/components/OcrQueuePanel";
import { ComparisonResult } from "@/components/ComparisonResult";
import { isEditableTarget, TablePagination, useEscape, usePaginatedItems } from "@/components/TablePagination";
import { useI18n } from "@/components/I18nProvider";
import { localeFlags, type TranslationKey } from "@/lib/i18n";

const PdfViewer = dynamic(() => import("@/components/PdfViewer"), { ssr: false });

interface PdfRecord { id: string; original_name: string; page_count: number; size_bytes: string; uploaded_at: string; document_date: string | null; }
interface OpenPdf extends PdfRecord { page: number; zoom: number; rotation: number; }
interface TrackedExtraction { id: string; displayId: string; }
interface ExtractionNotification extends TrackedExtraction { filename: string; }
type Modal = "upload" | "library" | "windows" | "help" | "extractPages" | "extractionQueued" | "extractionResult" | "compare" | null;

function parsePageSelection(value: string, pageCount: number) {
  const pages = new Set<number>();
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const single = part.match(/^\d+$/);
    if (!range && !single) throw new Error("INVALID_PAGE_SELECTION");
    const start = Number(range?.[1] ?? part);
    const end = Number(range?.[2] ?? part);
    if (start < 1 || end > pageCount || start > end) throw new Error("INVALID_PAGE_SELECTION");
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  if (!pages.size) throw new Error("INVALID_PAGE_SELECTION");
  return [...pages].sort((left, right) => left - right);
}

function closeOpenMenus(except?: HTMLDetailsElement) {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

function ModalFrame({ title, children, onClose, closeLabel, wide = false }: { title: string; children: ReactNode; onClose: () => void; closeLabel: string; wide?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEscape(onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (outside) onClose();
      }}
    >
      <header><h2>{title}</h2><button className="icon-button" title={closeLabel} onClick={onClose}><X size={18} /></button></header>
      {children}
    </dialog>,
    document.body,
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return <details className="menu" onToggle={(event) => {
    if (!event.currentTarget.open) return;
    closeOpenMenus(event.currentTarget);
  }}><summary
    onMouseDown={(event) => event.preventDefault()}
    onClick={(event) => {
      event.preventDefault();
      const menu = event.currentTarget.parentElement as HTMLDetailsElement;
      menu.open = !menu.open;
    }}
  >{label}<ChevronDown size={12} /></summary><div className="menu-popover">{children}</div></details>;
}

function MenuItem({ children, checked, disabled, onClick, shortcut }: { children: ReactNode; checked?: boolean; disabled?: boolean; onClick?: () => void; shortcut?: string }) {
  return <button
    disabled={disabled || !onClick}
    onMouseDown={(event) => event.preventDefault()}
    onClick={(event) => {
      onClick?.();
      event.currentTarget.closest("details")?.removeAttribute("open");
    }}
  >
    {checked !== undefined && <span className="menu-check" aria-hidden="true">{checked ? "✓" : ""}</span>}
    <span className="menu-item-label">{children}</span>
    {shortcut && <kbd>{shortcut}</kbd>}
  </button>;
}

export default function Workbench({ user, compareBaseUrl = null }: { user: SessionUser; compareBaseUrl?: string | null }) {
  const router = useRouter();
  const { locale, t, formatDate, formatNumber } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openPdfs, setOpenPdfs] = useState<OpenPdf[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [library, setLibrary] = useState<PdfRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: keyof PdfRecord; direction: 1 | -1 }>({ key: "uploaded_at", direction: -1 });
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState<SearchOptions>({ query: "", wholeWord: false, caseSensitive: false, current: 0 });
  const [matches, setMatches] = useState<{ page: number; text: string }[]>([]);
  const [selectedPdfText, setSelectedPdfText] = useState("");
  const [tool, setTool] = useState("select");
  const [annotationColor, setAnnotationColor] = useState("#f5d90a");
  const [undoRequest, setUndoRequest] = useState(0);
  const [redoRequest, setRedoRequest] = useState(0);
  const [canUndoAnnotation, setCanUndoAnnotation] = useState(false);
  const [canRedoAnnotation, setCanRedoAnnotation] = useState(false);
  const [historyDocumentId, setHistoryDocumentId] = useState<string | null>(null);
  const [view, setView] = useState<"viewer" | "params" | "users" | "conversions" | "ocr" | "audit" | "errors" | "comparison">("viewer");
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedConversionId, setSelectedConversionId] = useState<string | null>(null);
  const [pageSelection, setPageSelection] = useState("");
  const [pageSelectionError, setPageSelectionError] = useState("");
  const [extractionResult, setExtractionResult] = useState("");
  const [extractionJson, setExtractionJson] = useState<unknown>(null);
  const [extractionFilename, setExtractionFilename] = useState("");
  const [extractionFormat, setExtractionFormat] = useState<"text" | "json">("text");
  const [extractionProcessing, setExtractionProcessing] = useState(false);
  const [queuedExtraction, setQueuedExtraction] = useState<{ id: string; displayId: string } | null>(null);
  const [trackedExtractions, setTrackedExtractions] = useState<TrackedExtraction[]>([]);
  const [extractionTrackingReady, setExtractionTrackingReady] = useState(false);
  const [extractionNotifications, setExtractionNotifications] = useState<ExtractionNotification[]>([]);
  const [compareFirstId, setCompareFirstId] = useState<string | null>(null);
  const [compareSecondId, setCompareSecondId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareJobId, setCompareJobId] = useState<string | null>(null);
  const [compareResultId, setCompareResultId] = useState<string | null>(null);
  const [compareOffset, setCompareOffset] = useState(3);
  const [compareFatSim, setCompareFatSim] = useState(0.7);
  const [comparePosFixa, setComparePosFixa] = useState(true);
  const [compareMaxPages, setCompareMaxPages] = useState(0);
  const [compareError, setCompareError] = useState("");
  const active = openPdfs.find((item) => item.id === activeId) ?? null;
  const compareFirst = openPdfs.find((item) => item.id === compareFirstId) ?? null;
  const extractionStorageKey = `patsxpdf-extractions-${user.id}`;

  const loadLibrary = useCallback(async () => {
    const response = await fetch("/api/documents");
    if (response.ok) {
      const records = await response.json() as PdfRecord[];
      setLibrary(records);
      setSelectedId((current) => current && records.some((item) => item.id === current) ? current : records[0]?.id ?? null);
    }
  }, []);

  const handleAnnotationHistoryChange = useCallback((documentId: string, canUndo: boolean, canRedo: boolean) => {
    setHistoryDocumentId(documentId);
    setCanUndoAnnotation(canUndo);
    setCanRedoAnnotation(canRedo);
  }, []);

  useEffect(() => {
    let activeRequest = true;
    fetch("/api/documents").then((response) => response.ok ? response.json() : []).then((data) => {
      if (activeRequest) {
        const records = data as PdfRecord[];
        setLibrary(records);
        setSelectedId((current) => current && records.some((item) => item.id === current) ? current : records[0]?.id ?? null);
      }
    });
    return () => { activeRequest = false; };
  }, []);

  useEffect(() => {
    function closeMenusOutside(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("details.menu")) return;
      closeOpenMenus();
    }
    document.addEventListener("pointerdown", closeMenusOutside);
    return () => document.removeEventListener("pointerdown", closeMenusOutside);
  }, []);

  useEffect(() => {
    function preventFileNavigation(event: globalThis.DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    }
    document.addEventListener("dragover", preventFileNavigation);
    document.addEventListener("drop", preventFileNavigation);
    return () => {
      document.removeEventListener("dragover", preventFileNavigation);
      document.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  function openDocument(record: PdfRecord) {
    if (record.id !== activeId || view !== "viewer") setProcessing(true);
    setOpenPdfs((current) => current.some((item) => item.id === record.id) ? current : [...current, { ...record, page: 1, zoom: 100, rotation: 0 }]);
    setActiveId(record.id); setModal(null); setView("viewer");
  }

  function activateDocument(id: string) {
    if (id !== activeId || view !== "viewer") setProcessing(true);
    setActiveId(id);
    setView("viewer");
  }

  function updateActive(values: Partial<OpenPdf>) {
    if (activeId) setOpenPdfs((current) => current.map((item) => item.id === activeId ? { ...item, ...values } : item));
  }

  const closeDocument = useCallback((id = activeId) => {
    if (!id) return;
    if (id === compareFirstId) setCompareFirstId(null);
    if (id === compareSecondId) setCompareSecondId(null);
    const index = openPdfs.findIndex((item) => item.id === id);
    const remaining = openPdfs.filter((item) => item.id !== id);
    setOpenPdfs(remaining);
    if (id === activeId) {
      const nextId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
      setProcessing(Boolean(nextId));
      setActiveId(nextId);
    }
  }, [activeId, compareFirstId, compareSecondId, openPdfs]);

  const closeAllDocuments = useCallback(() => {
    if (!openPdfs.length || !confirm(t("question.confirmCloseAll"))) return;
    setOpenPdfs([]);
    setActiveId(null);
    setProcessing(false);
    setCompareFirstId(null);
    setCompareSecondId(null);
  }, [openPdfs.length, t]);

  const closeOtherDocuments = useCallback(() => {
    if (!active) return;
    setExtractionFilename(active.original_name);
    setOpenPdfs([active]);
  }, [active]);

  const markFirst = useCallback(() => {
    if (!active) return;
    setCompareFirstId((current) => (current === active.id ? null : active.id));
    setCompareSecondId(null);
  }, [active]);

  const clearCompare = useCallback(() => {
    setCompareFirstId(null);
    setCompareSecondId(null);
  }, []);

  const canCompare = Boolean(compareFirstId && active && active.id !== compareFirstId && !comparing);

  const startCompare = useCallback(async () => {
    if (!compareFirstId || !active || active.id === compareFirstId) return;
    const firstId = compareFirstId;
    const secondId = active.id;
    setComparing(true);
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstId,
          secondId,
          OFFSET: compareOffset,
          FATSIM: compareFatSim,
          POSFIXA: comparePosFixa,
          MAX_PAGES: compareMaxPages,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; jobId?: string };
      if (!response.ok) throw new Error(result.error ?? t("compare.failed"));
      if (!result.jobId) throw new Error(t("compare.failed"));
      setCompareFirstId(null);
      setCompareSecondId(null);
      setCompareJobId(result.jobId);
    } catch (error) {
      console.error("Unable to start the comparison.", error);
      setComparing(false);
      window.alert(error instanceof Error ? error.message : t("compare.failed"));
    }
  }, [active, compareFirstId, compareOffset, compareFatSim, comparePosFixa, compareMaxPages, t]);

  function submitCompare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCompare) return;
    if (!comparePosFixa && (!Number.isInteger(compareOffset) || compareOffset < 0 || compareOffset > 9)) {
      setCompareError(t("compare.invalidOffset"));
      return;
    }
    if (!comparePosFixa && !(compareFatSim >= 0.1 && compareFatSim <= 1)) {
      setCompareError(t("compare.invalidFatsim"));
      return;
    }
    if (!Number.isInteger(compareMaxPages) || compareMaxPages < 0 || compareMaxPages > 9999999) {
      setCompareError(t("compare.invalidMaxPages"));
      return;
    }
    setCompareError("");
    setModal(null);
    void startCompare();
  }

  const openCompareDialog = useCallback(() => {
    if (!active) return;
    setCompareError("");
    setCompareSecondId(active.id);
    setModal("compare");
  }, [active]);

  async function upload(file?: File) {
    if (!file) return;
    const isOfficeDocument = /\.(docx|xlsx|pptx)$/i.test(file.name);
    const conversionId = isOfficeDocument ? crypto.randomUUID() : null;
    setModal(null);
    setUploading(true);
    setProcessing(!isOfficeDocument);
    if (conversionId) {
      setSelectedConversionId(conversionId);
      setView("conversions");
    }
    try {
      const data = new FormData();
      data.set("file", file);
      if (conversionId) data.set("conversionId", conversionId);
      const response = await fetch("/api/documents", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) {
        setProcessing(false);
        if (result.conversionId) {
          setSelectedConversionId(result.conversionId);
          setView("conversions");
          return;
        }
        return window.alert(result.error ?? t("viewer.uploadFailed"));
      }
      await loadLibrary();
      if (result.officeDocument) {
        setSelectedConversionId(result.conversionId);
        setView("conversions");
      } else {
        openDocument(result);
      }
    } catch {
      setProcessing(false);
      window.alert(t("viewer.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  const goMatch = useCallback((index: number) => {
    if (!matches.length) return;
    const next = Math.max(0, Math.min(matches.length - 1, index));
    setSearch((value) => ({ ...value, current: next }));
    setOpenPdfs((current) => current.map((item) => item.id === activeId ? { ...item, page: matches[next].page } : item));
  }, [activeId, matches]);

  function closeSearch() {
    setSearchOpen(false);
    setSearch((value) => ({ ...value, query: "", current: 0 }));
    setMatches([]);
  }

  const openCurrentSearch = useCallback(() => {
    if (!activeId) return;
    setView("viewer");
    setSearchOpen(true);
  }, [activeId]);

  const clearPdfSelection = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setSelectedPdfText("");
  }, []);

  const copyPdfSelection = useCallback(async () => {
    if (!selectedPdfText) return;
    try {
      await navigator.clipboard.writeText(selectedPdfText);
    } catch (error) {
      console.error("Unable to copy selected PDF text.", error);
      window.alert(t("menu.copyFailed"));
    }
  }, [selectedPdfText, t]);

  function fitZoom(mode: "height" | "width" | "page") {
    if (!active) return;
    const scroller = document.querySelector<HTMLElement>(".pdf-scroll");
    const renderedPage = scroller?.querySelector<HTMLElement>(`.pdf-page[data-page-number="${active.page}"] .react-pdf__Page`);
    if (!scroller || !renderedPage) return;
    const bounds = renderedPage.getBoundingClientRect();
    const availableWidth = Math.max(1, scroller.clientWidth - 48);
    const availableHeight = Math.max(1, scroller.clientHeight - 48);
    const widthZoom = active.zoom * availableWidth / bounds.width;
    const heightZoom = active.zoom * availableHeight / bounds.height;
    const nextZoom = mode === "width" ? widthZoom : mode === "height" ? heightZoom : Math.min(widthZoom, heightZoom);
    updateActive({ zoom: Math.min(500, Math.max(5, Math.round(nextZoom))) });
    if (mode === "page") {
      requestAnimationFrame(() => {
        renderedPage.closest<HTMLElement>(".pdf-page")?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    }
  }

  const extractPages = useCallback(async (pageNumbers: number[]) => {
    if (!active) return;
    setModal(null);
    if (pageNumbers.length === 1) setExtractionProcessing(true);
    try {
      const response = await fetch("/api/extractions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: active.id, pages: pageNumbers }),
      });
      const result = await response.json() as { id?: string; displayId?: string; text?: string; json?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error ?? t("extract.failed"));
      if (pageNumbers.length === 1) {
        setExtractionResult(result.text ?? "");
        setExtractionJson(result.json ?? null);
        setExtractionFormat("text");
        setModal("extractionResult");
      } else if (result.id && result.displayId) {
        setQueuedExtraction({ id: result.id, displayId: result.displayId });
        setTrackedExtractions((current) => current.some((item) => item.id === result.id)
          ? current
          : [...current, { id: result.id!, displayId: result.displayId! }]);
        setModal("extractionQueued");
      }
    } catch (error) {
      console.error("Unable to extract PDF text.", error);
      window.alert(error instanceof Error ? error.message : t("extract.failed"));
    } finally {
      setExtractionProcessing(false);
    }
  }, [active, t]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(extractionStorageKey) ?? "[]") as TrackedExtraction[];
        setTrackedExtractions(stored.filter((item) => typeof item.id === "string" && typeof item.displayId === "string"));
      } catch {
        localStorage.removeItem(extractionStorageKey);
      } finally {
        setExtractionTrackingReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [extractionStorageKey]);

  useEffect(() => {
    if (!extractionTrackingReady) return;
    localStorage.setItem(extractionStorageKey, JSON.stringify(trackedExtractions));
  }, [extractionStorageKey, extractionTrackingReady, trackedExtractions]);

  useEffect(() => {
    if (!trackedExtractions.length) return;
    let activeRequest = true;
    async function checkExtractions() {
      const completed: ExtractionNotification[] = [];
      const failed: string[] = [];
      await Promise.all(trackedExtractions.map(async (extraction) => {
        const response = await fetch(`/api/extractions/${extraction.id}`);
        if (!response.ok) return;
        const task = await response.json() as { status: string; original_name: string };
        if (task.status === "completed") completed.push({ ...extraction, filename: task.original_name });
        else if (task.status === "error") failed.push(extraction.id);
      }));
      if (!activeRequest || (!completed.length && !failed.length)) return;
      const finishedIds = new Set([...completed.map((item) => item.id), ...failed]);
      setTrackedExtractions((current) => current.filter((item) => !finishedIds.has(item.id)));
      setExtractionNotifications((current) => [
        ...current,
        ...completed.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      if (failed.length) window.alert(t("extract.failed"));
    }
    void checkExtractions();
    const interval = window.setInterval(() => void checkExtractions(), 3000);
    return () => {
      activeRequest = false;
      window.clearInterval(interval);
    };
  }, [trackedExtractions, t]);

  async function openExtractionNotification(notification: ExtractionNotification) {
    try {
      const [textResponse, jsonResponse] = await Promise.all([
        fetch(`/api/extractions/${notification.id}/text`),
        fetch(`/api/extractions/${notification.id}/json`),
      ]);
      if (!textResponse.ok || !jsonResponse.ok) throw new Error(t("extract.failed"));
      setExtractionResult(await textResponse.text());
      setExtractionJson(await jsonResponse.json());
      setExtractionFilename(notification.filename);
      setExtractionFormat("text");
      setExtractionNotifications((current) => current.filter((item) => item.id !== notification.id));
      setModal("extractionResult");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("extract.failed"));
    }
  }

  function downloadExtraction() {
    const content = extractionFormat === "text" ? extractionResult : JSON.stringify(extractionJson, null, 2);
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([content], { type: extractionFormat === "text" ? "text/plain;charset=utf-8" : "application/json" }));
    anchor.download = `${extractionFilename}.${extractionFormat === "text" ? "txt" : "json"}`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function submitPageSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    try {
      const pages = parsePageSelection(pageSelection, active.page_count);
      setPageSelectionError("");
      void extractPages(pages);
    } catch {
      setPageSelectionError(t("extract.invalidPages"));
    }
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }
  const sortedLibrary = [...library].sort((a, b) => String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? ""), locale, { numeric: true }) * sort.direction);
  const selectedLibraryIndex = sortedLibrary.findIndex((item) => item.id === selectedId);
  const {
    page: libraryPage,
    pageCount: libraryPageCount,
    pageItems: libraryPageItems,
    setContainer: setLibraryContainer,
    setPage: setLibraryPage,
  } = usePaginatedItems({
    items: sortedLibrary,
    active: modal === "library",
    allowInModal: true,
    selectedIndex: selectedLibraryIndex,
    onSelectIndex: (index) => setSelectedId(sortedLibrary[index].id),
  });

  useEffect(() => {
    if (view !== "viewer" || !activeId || modal || profileOpen) return;
    function handleViewerKeys(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      let destination: "previous" | "next" | "first" | "last" | null = null;
      if (event.key === "PageDown" && !event.ctrlKey && !event.altKey && !event.metaKey) destination = "next";
      else if (event.key === "PageUp" && !event.ctrlKey && !event.altKey && !event.metaKey) destination = "previous";
      else if (event.ctrlKey && event.key === "Home") destination = "first";
      else if (event.ctrlKey && event.key === "End") destination = "last";
      if (!destination) return;

      event.preventDefault();
      setOpenPdfs((current) => current.map((item) => {
        if (item.id !== activeId) return item;
        if (destination === "first") return { ...item, page: 1 };
        if (destination === "last") return { ...item, page: item.page_count };
        if (destination === "next") return { ...item, page: Math.min(item.page_count, item.page + 1) };
        return { ...item, page: Math.max(1, item.page - 1) };
      }));
    }
    document.addEventListener("keydown", handleViewerKeys);
    return () => document.removeEventListener("keydown", handleViewerKeys);
  }, [activeId, modal, profileOpen, view]);

  useEffect(() => {
    if (modal || profileOpen) return;
    const annotationColors = ["#f5d90a", "#e86f12", "#26c6da", "#3478f6", "#8b8f97", "#ef77ad", "#e5484d"];
    function handleMenuShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      let handled = true;

      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === "c" && selectedPdfText) void copyPdfSelection();
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "o") setModal("upload");
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "o") setModal("library");
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "c" && selectedPdfText) clearPdfSelection();
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "c") setView("conversions");
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "e" && active) void extractPages([active.page]);
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "e" && active) { setPageSelection(""); setPageSelectionError(""); setModal("extractPages"); }
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "f4" && openPdfs.length) closeAllDocuments();
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "f4" && active) closeOtherDocuments();
      else if (!event.ctrlKey && !event.altKey && !event.shiftKey && key === "f4" && active) closeDocument();
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "f" && active) openCurrentSearch();
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "w" && active) setSearch((value) => ({ ...value, wholeWord: !value.wholeWord }));
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "m" && active) setSearch((value) => ({ ...value, caseSensitive: !value.caseSensitive }));
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "f2" && matches.length) goMatch(0);
      else if (!event.ctrlKey && !event.altKey && !event.shiftKey && key === "f2" && matches.length) goMatch(search.current - 1);
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "f3" && matches.length) goMatch(matches.length - 1);
      else if (!event.ctrlKey && !event.altKey && !event.shiftKey && key === "f3" && matches.length) goMatch(search.current + 1);
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && key === "t" && active) setTool("note");
      else if (event.altKey && !event.ctrlKey && !event.shiftKey && /^[1-7]$/.test(key) && active) setAnnotationColor(annotationColors[Number(key) - 1]);
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "w" && openPdfs.length) setModal("windows");
      else if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "f1") setModal("help");
      else if (!event.ctrlKey && !event.altKey && !event.shiftKey && key === "f7" && active) markFirst();
      else if (!event.ctrlKey && !event.altKey && !event.shiftKey && key === "f8" && canCompare) openCompareDialog();
      else if (!event.ctrlKey && !event.altKey && !event.shiftKey && key === "f9" && (compareFirstId || compareSecondId)) clearCompare();
      else handled = false;

      if (handled) event.preventDefault();
    }
    document.addEventListener("keydown", handleMenuShortcut);
    return () => document.removeEventListener("keydown", handleMenuShortcut);
  }, [active, canCompare, clearCompare, clearPdfSelection, closeAllDocuments, closeDocument, closeOtherDocuments, compareFirstId, compareSecondId, copyPdfSelection, extractPages, goMatch, markFirst, matches, modal, openCompareDialog, openCurrentSearch, openPdfs, profileOpen, search, selectedPdfText, startCompare]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    if (!compareJobId) return;
    let active = true;
    async function checkStatus() {
      try {
        const response = await fetch(`/api/compare/${compareJobId}`);
        const result = await response.json().catch(() => ({})) as { status?: string; error?: string };
        if (result.status === "failed") {
          setComparing(false);
          setCompareJobId(null);
          window.alert(result.error ? `${t("compare.failed")} ${result.error}` : t("compare.failed"));
        } else if (result.status === "done") {
          setComparing(false);
          setCompareJobId(null);
          setCompareResultId(compareJobId);
          setView("comparison");
        }
      } catch {
        /* transient failure: keep polling */
      }
    }
    void checkStatus();
    const interval = window.setInterval(() => { if (active) void checkStatus(); }, 3000);
    return () => { active = false; window.clearInterval(interval); };
  }, [compareJobId, t]);

  return (
    <main className={`workbench ${view === "viewer" ? "" : "administration-view"}`}>
      {/* Top bar */}
      <header className="app-header">
        {/* Logo */}
        <div className="app-title"><strong>Pats<span>XPDF</span></strong></div>
        {/* Horizontal Menu */}
        <nav className="menu-bar">
          {/* File */}
          <Menu label={t("menu.file")}>
            <MenuItem shortcut="Ctrl+O" onClick={() => setModal("upload")}><FilePlus2 size={15} />{t("menu.file.upload")}</MenuItem>
            <MenuItem shortcut="Alt+O" onClick={() => setModal("library")}><FolderOpen size={15} />{t("menu.file.open")}</MenuItem>
            <MenuItem shortcut="Alt+C" onClick={() => setView("conversions")}><ListChecks size={15} />{t("menu.file.conversions")}</MenuItem>
            <span className="menu-separator" />
            <MenuItem shortcut="F4" disabled={!active} onClick={() => closeDocument()}>{t("common.close")}</MenuItem>
            <MenuItem shortcut="Alt+F4" disabled={!openPdfs.length} onClick={closeAllDocuments}>{t("menu.file.closeAll")}</MenuItem>
            <MenuItem shortcut="Ctrl+F4" disabled={!active || openPdfs.length < 2} onClick={closeOtherDocuments}>{t("menu.file.closeOthers")}</MenuItem>
            <span className="menu-separator" />
            <MenuItem shortcut="Ctrl+D" disabled={!active}>{t("menu.file.download")}</MenuItem>
            <span className="menu-separator" />
            <MenuItem onClick={logout}><LogOut size={15} />{t("common.exit")}</MenuItem>
          </Menu>
          {/* Edit */}
          <Menu label={t("menu.edit")}>
            <MenuItem shortcut="Ctrl+Z" disabled={!active || historyDocumentId !== active.id || !canUndoAnnotation} onClick={() => setUndoRequest((current) => current + 1)}>{t("menu.undo")}</MenuItem>
            <MenuItem shortcut="Ctrl+Y" disabled={!active || historyDocumentId !== active.id || !canRedoAnnotation} onClick={() => setRedoRequest((current) => current + 1)}>{t("menu.redo")}</MenuItem>
            <span className="menu-separator" />
            <MenuItem shortcut="Ctrl+C" disabled={!selectedPdfText} onClick={() => void copyPdfSelection()}>{t("menu.copy")}</MenuItem>
            <MenuItem shortcut="Alt+C" disabled={!selectedPdfText} onClick={clearPdfSelection}>{t("menu.deselect")}</MenuItem>
          </Menu>
          {/* Search */}
          <Menu label={t("menu.search")}>
            <MenuItem shortcut="Ctrl+F" disabled={!active} onClick={openCurrentSearch}>{t("menu.search.current")}</MenuItem>
            <MenuItem shortcut="Shift+Ctrl+F">{t("menu.search.allOpen")}</MenuItem>
            <MenuItem shortcut="Alt+F">{t("menu.search.library")}</MenuItem>
            <span className="menu-separator" />
            <MenuItem shortcut="Alt+W" disabled={!active} onClick={() => setSearch({ ...search, wholeWord: !search.wholeWord })}>{search.wholeWord ? t("viewer.wholeWord") : t("viewer.partialWord")}</MenuItem>
            <MenuItem shortcut="Alt+M" disabled={!active} onClick={() => setSearch({ ...search, caseSensitive: !search.caseSensitive })}>{search.caseSensitive ? t("viewer.matchCase") : t("viewer.ignoreCase")}</MenuItem>
            <span className="menu-separator" />
            <MenuItem shortcut="Ctrl+F2" disabled={!matches.length} onClick={() => goMatch(0)}>{t("viewer.firstMatch")}</MenuItem>
            <MenuItem shortcut="F2" disabled={!matches.length} onClick={() => goMatch(search.current - 1)}>{t("viewer.previousMatch")}</MenuItem>
            <MenuItem shortcut="F3" disabled={!matches.length} onClick={() => goMatch(search.current + 1)}>{t("viewer.nextMatch")}</MenuItem>
            <MenuItem shortcut="Ctrl+F3" disabled={!matches.length} onClick={() => goMatch(matches.length - 1)}>{t("viewer.lastMatch")}</MenuItem>
          </Menu>
          {/* Annotations */}
          <Menu label={t("menu.annotations")}>
            <MenuItem shortcut="Alt+T" disabled={!active} onClick={() => setTool("note")}>{t("menu.annotations.text")}</MenuItem>
            <MenuItem disabled={!active} onClick={() => setTool("circle")}>{t("menu.annotations.circle")}</MenuItem>
            <MenuItem disabled={!active} onClick={() => setTool("rectangle")}>{t("menu.annotations.rectangle")}</MenuItem>
            <MenuItem disabled={!active} onClick={() => setTool("freehand")}>{t("menu.annotations.freehand")}</MenuItem>
            <MenuItem disabled={!active} onClick={() => setTool("highlight")}>{t("viewer.highlight")}</MenuItem>
            <span className="menu-separator" />
            {[
              ["#f5d90a", "menu.color.yellow", "Alt+1"],
              ["#e86f12", "menu.color.orange", "Alt+2"],
              ["#26c6da", "menu.color.cyan", "Alt+3"],
              ["#3478f6", "menu.color.blue", "Alt+4"],
              ["#8b8f97", "menu.color.gray", "Alt+5"],
              ["#ef77ad", "menu.color.pink", "Alt+6"],
              ["#e5484d", "menu.color.red", "Alt+7"],
            ].map(([color, label, shortcut]) => <MenuItem key={color} checked={annotationColor === color} shortcut={shortcut} disabled={!active} onClick={() => setAnnotationColor(color)}>{t(label as TranslationKey)}</MenuItem>)}
            <span className="menu-separator" />
            <MenuItem shortcut="Ctrl+Del">{t("menu.annotations.delete")}</MenuItem>
          </Menu>
          {/* Extract */}
          <Menu label={t("menu.extract")}>
            <MenuItem shortcut="Ctrl+E" disabled={!active} onClick={() => active && void extractPages([active.page])}>{t("menu.extract.page")}</MenuItem>
            <MenuItem shortcut="Alt+E" disabled={!active} onClick={() => { setPageSelection(""); setPageSelectionError(""); setModal("extractPages"); }}>{t("menu.extract.pages")}</MenuItem>
            <span className="menu-separator" />
            <MenuItem onClick={() => setView("ocr")}>{t("menu.extract.ocrQueue")}</MenuItem>
          </Menu>
          {/* Compare */}
          <Menu label={t("menu.compare")}>
            <MenuItem shortcut="F7" disabled={!active || comparing} onClick={markFirst}>{t("menu.compare.markFirst")}</MenuItem>
            <MenuItem shortcut="F8" disabled={!canCompare} onClick={openCompareDialog}>{t("menu.compare.run")}</MenuItem>
            <MenuItem shortcut="F9" disabled={!(compareFirstId || compareSecondId) || comparing} onClick={clearCompare}>{t("menu.compare.clear")}</MenuItem>
          </Menu>
          {/* Window */}
          <Menu label={t("menu.window")}>
            <MenuItem shortcut="Ctrl+W" disabled={!openPdfs.length} onClick={() => setModal("windows")}>{t("viewer.openWindows")}</MenuItem>
            <span className="menu-separator" />
            {openPdfs.slice(0, 20).map((item) => <MenuItem key={item.id} checked={item.id === activeId} onClick={() => activateDocument(item.id)}>{item.original_name}</MenuItem>)}
            {!openPdfs.length && <span className="menu-empty">{t("menu.window.noPdf")}</span>}
            {openPdfs.length > 20 && <MenuItem onClick={() => setModal("windows")}>{t("menu.window.more")}</MenuItem>}
          </Menu>
          {/* Settings */}
          <Menu label={t("common.settings")}><MenuItem onClick={() => setView("params")}>{t("menu.parameters")}</MenuItem><MenuItem onClick={() => setView("users")}>{t("menu.users")}</MenuItem>{user.isAdmin && <><MenuItem onClick={() => setView("audit")}>{t("audit.title")}</MenuItem><MenuItem onClick={() => setView("errors")}>{t("errorLog.title")}</MenuItem></>}</Menu>
          {/* Help */}
          <Menu label={t("menu.help")}>
            <MenuItem shortcut="F1">{t("menu.help.page")}</MenuItem>
            <MenuItem shortcut="Ctrl+F1" onClick={() => setModal("help")}>{t("menu.about")}</MenuItem>
          </Menu>
        </nav>
        <div className="user-area">
          <span className="locale-flag" role="img" aria-label={t(`language.${locale}` as TranslationKey)} title={t(`language.${locale}` as TranslationKey)}>{localeFlags[locale]}</span>
          {/* Avatar with popup menu */}
          <details className="user-menu menu" onToggle={(event) => { if (event.currentTarget.open) closeOpenMenus(event.currentTarget); }}>
            <summary className="user-avatar" title={user.name} aria-label={`Menu de ${user.name}`}>{user.initials}</summary>
            <div className="menu-popover">
              <MenuItem onClick={() => setProfileOpen(true)}><UserRound size={15} />{t("menu.avatar.profile")}</MenuItem>
              <span className="menu-separator" />
              <MenuItem onClick={logout}><LogOut size={15} />{t("common.exit")}</MenuItem>
            </div>
          </details>
        </div>
      </header>

      {view === "viewer" && <>
      {/* Toolbar for PDF navigation */}
      <section className="toolbar" aria-label={t("viewer.tools")}>
        <div className="tool-group">
          <button
            title={t("viewer.firstPage")} disabled={!active || active.page === 1}
            onClick={() => updateActive({ page: 1 })}>
              <StepBack size={16} />
            </button>
          <button
            title={t("viewer.previousPage")}
            disabled={!active || active.page === 1}
            onClick={() => updateActive({ page: Math.max(1, active!.page - 1) })}>
              <Play size={15} style={{ transform: "scaleX(-1)" }} />
          </button>
          <input
            className="page-input" aria-label={t("viewer.page")}
            disabled={!active}
            value={active?.page ?? ""}
            onChange={(event) => updateActive({ page: Math.min(active!.page_count, Math.max(1, Number(event.target.value))) })}
          />
          <button
            title={t("viewer.nextPage")}
            disabled={!active || active.page === active.page_count}
            onClick={() => updateActive({ page: active!.page + 1 })}>
              <Play size={16} />
          </button>
          <button
            title={t("viewer.lastPage")}
            disabled={!active || active.page === active.page_count}
            onClick={() => updateActive({ page: active!.page_count })}>
              <StepForward size={16} />
          </button>
          <span className="page-total">({t("viewer.pages", { count: formatNumber(active?.page_count ?? 0) })})</span>
        </div>
        <div className="tool-group">
          <button className={searchOpen ? "active" : ""} title={t("viewer.searchInDoc")} disabled={!active} onClick={() => setSearchOpen(true)}>
            <Search size={16} />
          </button>
        </div>
        {/* Annotation controls */}
        <div className="tool-group annotation-tools">
          <button className={tool === "note" ? "active" : ""} title={t("viewer.note")} disabled={!active} onClick={() => setTool("note")}><MessageSquareText size={16} /></button>
          <button className={tool === "circle" ? "active" : ""} title={t("viewer.circle")} disabled={!active} onClick={() => setTool("circle")}><Circle size={16} /></button>
          <button className={tool === "rectangle" ? "active" : ""} title={t("viewer.rectangle")} disabled={!active} onClick={() => setTool("rectangle")}><RectangleHorizontal size={16} /></button>
          <button className={tool === "freehand" ? "active" : ""} title={t("viewer.freehand")} disabled={!active} onClick={() => setTool("freehand")}><Pencil size={16} /></button>
          <button className={tool === "highlight" ? "active" : ""} title={t("viewer.highlight")} disabled={!active} onClick={() => setTool("highlight")}><Highlighter size={16} /></button>
          <div className="color-picker" title={t("viewer.annotationColor")}>{["#f5d90a", "#e86f12", "#26c6da", "#3478f6", "#8b8f97", "#ef77ad", "#e5484d"].map((color) => <button key={color} aria-label={t("viewer.color", { color })} className={annotationColor === color ? "selected" : ""} style={{ backgroundColor: color }} onClick={() => setAnnotationColor(color)} />)}</div>
        </div>
        <div className="tool-group view-tools" aria-label={t("viewer.viewControls")}>
          <button title={t("viewer.zoomOut")} disabled={!active} onClick={() => updateActive({ zoom: Math.max(5, active!.zoom - 10) })}><ZoomOut size={16} /></button>
          <input className="zoom-input" aria-label={t("viewer.zoom")} disabled={!active} value={active ? `${active.zoom}%` : ""} onChange={(event) => updateActive({ zoom: Math.min(500, Math.max(5, Number(event.target.value.replace("%", "")))) })} />
          <button title={t("viewer.zoomIn")} disabled={!active} onClick={() => updateActive({ zoom: Math.min(500, active!.zoom + 10) })}><ZoomIn size={16} /></button>
          <button title={t("viewer.fitHeight")} disabled={!active} onClick={() => fitZoom("height")}><MoveVertical size={16} /></button>
          <button title={t("viewer.fitWidth")} disabled={!active} onClick={() => fitZoom("width")}><MoveHorizontal size={16} /></button>
          <button title={t("viewer.fitPage")} disabled={!active} onClick={() => fitZoom("page")}><LucideFile size={16} /></button>
          <button title={t("viewer.rotateLeft")} disabled={!active} onClick={() => updateActive({ rotation: active!.rotation - 90 })}><RotateCcw size={16} /></button>
          <button title={t("viewer.rotateRight")} disabled={!active} onClick={() => updateActive({ rotation: active!.rotation + 90 })}><RotateCw size={16} /></button>
        </div>
      </section>

      {/* Document tabs */}
      <div className="document-tabs-row">
        <div className="document-tabs">{
          openPdfs.map((item) =>
            <button
              className={item.id === activeId ? "active" : ""}
              key={item.id}
              onClick={() => activateDocument(item.id)}>
              <span className="compare-tab-label">
                <span>{item.original_name}</span>
                {compareFirstId === item.id && <span className="compare-first-badge" title={t("menu.compare.markFirst")}>1</span>}
                {compareSecondId === item.id && <span className="compare-second-badge" title={t("menu.compare.markSecond")}>2</span>}
              </span>
              <X
                size={14}
                onClick={(event) => { event.stopPropagation(); closeDocument(item.id); }}
              />
            </button>)}
        </div>
        {searchOpen && <div className="floating-search" role="search" aria-label={t("viewer.searchInDoc")}>
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchInputRef}
            placeholder={t("viewer.searchInDoc")}
            disabled={!active}
            value={search.query}
            onChange={(event) => setSearch({ ...search, query: event.target.value, current: 0 })}
          />
          <button
            className="word-kind"
            title={search.wholeWord ? t("viewer.wholeWord") : t("viewer.partialWord")}
            disabled={!active}
            onClick={() => setSearch({ ...search, wholeWord: !search.wholeWord })}>
              {search.wholeWord ? "abc" : "*abc*"}
          </button>
          <button
            className="case-kind"
            title={search.caseSensitive ? t("viewer.matchCase") : t("viewer.ignoreCase")}
            disabled={!active}
            onClick={() => setSearch({ ...search, caseSensitive: !search.caseSensitive })}>
              {search.caseSensitive ? "ABC" : "Abc"}
          </button>
          <span title={t("viewer.matches")}>
            {matches.length ? `${search.current + 1}/${matches.length}` : "0/0"}
          </span>
          <button title={t("viewer.firstMatch")} disabled={!matches.length} onClick={() => goMatch(0)}><ArrowLeftToLine size={15} /></button>
          <button title={t("viewer.previousMatch")} disabled={!matches.length} onClick={() => goMatch(search.current - 1)}><ArrowLeft size={15} /></button>
          <button title={t("viewer.nextMatch")} disabled={!matches.length} onClick={() => goMatch(search.current + 1)}><ArrowRight size={15} /></button>
          <button title={t("viewer.lastMatch")} disabled={!matches.length} onClick={() => goMatch(matches.length - 1)}><ArrowRightToLine size={15} /></button>
          <button className="close-search" title={t("common.close")} aria-label={t("common.close")} onClick={closeSearch}><X size={16} /></button>
        </div>}
      </div>
          </>}

      {/* Document */}
      <section className="workspace">
        {view === "params" 
          ? <ParametersPanel onClose={() => setView("viewer")} /> 
          : view === "users" 
          ? <UsersPanel isAdmin={user.isAdmin} onClose={() => setView("viewer")} /> 
          : view === "conversions"
          ? <ConversionsPanel user={user} selectedId={selectedConversionId} onSelect={setSelectedConversionId} onOpen={openDocument} onClose={() => setView("viewer")} />
          : view === "ocr"
          ? <OcrQueuePanel user={user} onClose={() => setView("viewer")} />
          : view === "audit" && user.isAdmin
          ? <AuditPanel onClose={() => setView("viewer")} />
          : view === "errors" && user.isAdmin
          ? <ErrorLogPanel onClose={() => setView("viewer")} />
          : view === "comparison" && compareResultId
          ? <ComparisonResult jobId={compareResultId} baseUrl={compareBaseUrl} onClose={() => { setCompareResultId(null); setView("viewer"); }} />
          : active 
            ? <PdfViewer
              key={active.id}
              documentId={active.id} 
              page={active.page} 
              zoom={active.zoom} 
              rotation={active.rotation} 
              search={search} 
              tool={tool} 
              color={annotationColor}
              undoRequest={undoRequest}
              redoRequest={redoRequest}
              onMatches={setMatches} 
              onLoad={(pages) => updateActive({ page_count: pages })}
              onReady={() => setProcessing(false)}
              onLoadError={() => setProcessing(false)}
              onPageChange={(page) => updateActive({ page })}
              onTextSelectionChange={setSelectedPdfText}
              onHistoryChange={handleAnnotationHistoryChange} />
          : <div className="empty-state">
              <div className="empty-icon">
                <FolderOpen size={38} />
              </div>
              <h2>{t("viewer.emptyTitle")}</h2>
              <p>{t("viewer.emptyText")}</p>
              <div>
                <button 
                  className="primary-button" 
                  onClick={() => setModal("upload")}>
                  <Plus size={16} />{t("viewer.uploadPdf")}
                </button>
                <button 
                  className="secondary-button" 
                  onClick={() => setModal("library")}>
                  <FolderOpen size={16} />{t("viewer.openLibrary")}
                </button>
              </div>
            </div>
          }
      </section>

      {/* User profile dialog */}
      {profileOpen && <UserProfileDialog onClose={() => setProfileOpen(false)} />}
      
      {/* Modals for upload, library, windows, and help */}
      {modal === "upload" && <ModalFrame title={t("viewer.uploadTitle")} closeLabel={t("common.close")} onClose={() => setModal(null)}><div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files[0]); }}><FilePlus2 size={34} /><strong>{uploading ? t("viewer.uploading") : t("viewer.dropPdf")}</strong><span>{t("viewer.chooseFile")}</span><button className="primary-button" disabled={uploading} onClick={() => inputRef.current?.click()}>{t("viewer.browse")}</button><input ref={inputRef} hidden type="file" accept="application/pdf,.pdf,.docx,.xlsx,.pptx" onChange={(event: ChangeEvent<HTMLInputElement>) => void upload(event.target.files?.[0])} /></div></ModalFrame>}
      {modal === "library" && <ModalFrame title={t("viewer.openTitle")} closeLabel={t("common.close")} wide onClose={() => setModal(null)}><div className="modal-actions"><button className="primary-button" disabled={!selectedId} onClick={() => { const record = library.find((item) => item.id === selectedId); if (record) openDocument(record); }}><FolderOpen size={16} />{t("common.open")}</button></div><div ref={setLibraryContainer} className="table-scroll"><table><thead><tr>{[["original_name", t("viewer.file")], ["uploaded_at", t("viewer.uploadDate")], ["document_date", t("viewer.documentDate")], ["page_count", t("viewer.pages", { count: "" }).trim()]].map(([key, label]) => <th key={key} onClick={() => setSort({ key: key as keyof PdfRecord, direction: sort.key === key ? (sort.direction * -1) as 1 | -1 : 1 })}>{label}{sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : ""}</th>)}</tr></thead><tbody>{libraryPageItems.map((item) => <tr key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)} onDoubleClick={() => openDocument(item)}><td>{item.original_name}</td><td>{formatDate(item.uploaded_at)}</td><td>{item.document_date ? formatDate(item.document_date) : "-"}</td><td>{formatNumber(item.page_count)}</td></tr>)}</tbody></table></div><TablePagination page={libraryPage} pageCount={libraryPageCount} onPageChange={setLibraryPage} /></ModalFrame>}
      {modal === "windows" && <ModalFrame title={t("viewer.openWindows")} closeLabel={t("common.close")} wide onClose={() => setModal(null)}><div className="window-grid">{openPdfs.map((item) => <button key={item.id} onDoubleClick={() => { activateDocument(item.id); setModal(null); }}>{item.original_name}<small>{t("viewer.pages", { count: formatNumber(item.page_count) })}</small></button>)}</div></ModalFrame>}
      {modal === "help" && <ModalFrame title="PATSXPDF" closeLabel={t("common.close")} onClose={() => setModal(null)}><div className="about-content"><div className="brand-mark">P</div><h3>{t("viewer.about")}</h3><p>{t("viewer.version")}</p></div></ModalFrame>}
      {modal === "extractPages" && active && 
      <ModalFrame 
        title={t("menu.extract.pages")} 
        closeLabel={t("common.close")} 
        onClose={() => setModal(null)}
      >
        <form 
          className="extract-pages-form" 
          onSubmit={submitPageSelection}
        >
          <strong>{active.original_name}</strong>
          <span>{t("viewer.pages", { count: formatNumber(active.page_count) })}</span>
          <label>{t("extract.pagesLabel")}
            <input 
              autoFocus 
              value={pageSelection} 
              onChange={(event) => { 
                setPageSelection(event.target.value); 
                setPageSelectionError(""); 
              }} 
              placeholder={t("extract.pagesPlaceholder")} 
            />
          </label>
          <p>{t("extract.pagesInstructions")}</p>
          {pageSelectionError && 
          <p className="form-error" role="alert">{pageSelectionError}</p>
          }
          <div className="dialog-actions">
            <button 
              type="button" 
              className="secondary-button" 
              onClick={() => setModal(null)}
            >
              {t("common.cancel")}
            </button>
            <button 
              className="primary-button" 
              type="submit" 
              disabled={!pageSelection.trim()}
            >
              {t("menu.extract")}
            </button>
          </div>
        </form>
      </ModalFrame>}
      {modal === "compare" && canCompare && compareFirst && active &&
      <ModalFrame
        title={t("compare.title")}
        closeLabel={t("common.close")}
        onClose={() => setModal(null)}
      >
        <form className="compare-form" onSubmit={submitCompare} noValidate>
          <div className="compare-documents">
            <div>
              <span className="compare-doc-role">{t("compare.first")}</span>
              <strong title={compareFirst.original_name}>{compareFirst.original_name}</strong>
              <small>{t("viewer.pages", { count: formatNumber(compareFirst.page_count) })}</small>
            </div>
            <div>
              <span className="compare-doc-role">{t("compare.second")}</span>
              <strong title={active.original_name}>{active.original_name}</strong>
              <small>{t("viewer.pages", { count: formatNumber(active.page_count) })}</small>
            </div>
          </div>
          <label className="compare-check">
            <input
              type="checkbox"
              checked={comparePosFixa}
              onChange={(event) => setComparePosFixa(event.target.checked)}
            />
            {t("compare.posfixa")}
          </label>
          {!comparePosFixa && <div className="compare-grid">
            <label>{t("compare.offset")}
              <input
                type="number"
                min={0}
                max={9}
                step={1}
                value={compareOffset}
                onChange={(event) => setCompareOffset(Number(event.target.value))}
              />
            </label>
            <label>{t("compare.fatsim")}
              <input
                type="number"
                min={0.1}
                max={1}
                step={0.1}
                value={compareFatSim}
                onChange={(event) => setCompareFatSim(Number(event.target.value))}
              />
              <small>{t("compare.range")}</small>
            </label>
          </div>}
          <label>{t("compare.maxPages")}
            <input
              type="number"
              min={0}
              step={1}
              value={compareMaxPages}
              onChange={(event) => setCompareMaxPages(Number(event.target.value))}
            />
            <small>{t("compare.allPages")}</small>
          </label>
          {compareError && <p className="form-error" role="alert">{compareError}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setModal(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={comparing}
            >
              {t("compare.start")}
            </button>
          </div>
        </form>
      </ModalFrame>}
      {modal === "extractionQueued" && queuedExtraction && 
      <ModalFrame 
        title={t("extract.queuedTitle")} 
        closeLabel={t("common.close")} 
        onClose={() => setModal(null)}
      >
        <div className="extraction-queued">
          <p>{t("extract.queuedMessage", { id: queuedExtraction.displayId })}</p>
          <p>{t("extract.queuedInstructions")}</p>
          <div className="dialog-actions">
            <button 
              className="primary-button" 
              onClick={() => setModal(null)}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </ModalFrame>}
      {modal === "extractionResult" && 
      <ModalFrame 
        title={t("extract.resultTitle")} 
        closeLabel={t("common.close")} 
        wide 
        onClose={() => setModal(null)}
      >
        <div className="extraction-result">
          <strong>{extractionFilename}</strong>
          <textarea 
            readOnly 
            value={extractionResult} 
          />
          <fieldset className="extraction-formats">
            <legend>{t("extract.downloadFormat")}</legend>
            <label>
              <input 
                type="radio" 
                checked={extractionFormat === "text"} 
                onChange={() => setExtractionFormat("text")} 
              />
              {t("extract.formatText")}
            </label>
            <label>
              <input 
                type="radio" 
                checked={extractionFormat === "json"} 
                onChange={() => setExtractionFormat("json")} 
              />
              {t("extract.formatJson")}
            </label>
          </fieldset>
          <div className="dialog-actions">
            <button 
              className="secondary-button" 
              onClick={() => setModal(null)}
            >
              {t("common.close")}
            </button>
            <button 
              className="primary-button" 
              onClick={downloadExtraction}
            >
              {t("common.download")}
            </button>
          </div>
        </div>
      </ModalFrame>}

      <div className="extraction-toast-stack" aria-live="polite">
        {extractionNotifications.map((notification) => <button
          className="extraction-toast"
          key={notification.id}
          onClick={() => void openExtractionNotification(notification)}
        >
          <CheckCircle2 size={19} aria-hidden="true" />
          <span><strong>{t("extract.completedToast")}</strong><small>{t("extract.completedToastAction", { id: notification.displayId })}</small></span>
        </button>)}
      </div>

      {/* Overlay processing... */}
      {processing && 
      <div 
        className="processing-overlay" 
        role="status" 
        aria-live="assertive" 
        aria-label={t("viewer.processing")}
      >
        <div className="processing-indicator">
          <LoaderCircle size={30} aria-hidden="true" />
          <strong>{t("viewer.processing")}</strong>
        </div>
      </div>}
      {extractionProcessing && 
      <div 
        className="processing-overlay" 
        role="status" 
        aria-live="assertive"
        aria-label={t("extract.processing")}
      >
        <div className="processing-indicator">
          <LoaderCircle size={30} aria-hidden="true" />
          <strong>{t("extract.processing")}</strong>
        </div>
      </div>}
      {comparing && 
      <div 
        className="processing-overlay" 
        role="status" 
        aria-live="assertive"
        aria-label={t("compare.processing")}
      >
        <div className="processing-indicator">
          <LoaderCircle size={30} aria-hidden="true" />
          <strong>{t("compare.processing")}</strong>
        </div>
      </div>}
    </main>
  );
}
