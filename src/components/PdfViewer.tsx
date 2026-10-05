"use client";

import { PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { MessageSquareText, Trash2 } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export interface SearchOptions { query: string; wholeWord: boolean; caseSensitive: boolean; current: number; }
interface SearchMatch { page: number; text: string; itemIndex: number; occurrence: number; }

interface Props {
  documentId: string; page: number; zoom: number; rotation: number; search: SearchOptions;
  tool: string; color: string;
  undoRequest: number;
  redoRequest: number;
  onLoad: (pages: number, pdf: PDFDocumentProxy) => void;
  onReady: () => void;
  onLoadError: () => void;
  onPageChange: (page: number) => void;
  onMatches: (matches: { page: number; text: string }[]) => void;
  onTextSelectionChange: (text: string) => void;
  onHistoryChange: (documentId: string, canUndo: boolean, canRedo: boolean) => void;
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

interface Geometry { x: number; y: number; w: number; h: number; points?: { x: number; y: number }[]; }
interface Annotation { id: string; page: number; kind: "highlight" | "note" | "circle" | "rectangle" | "freehand"; color: string; geometry: Geometry; content?: string | null; }
type HistoryEntry = { type: "create"; annotation: Annotation } | { type: "delete"; annotation: Annotation } | { type: "move"; id: string; before: Geometry; after: Geometry };
interface NoteDrag { id: string; pointerId: number; startX: number; startY: number; before: Geometry; current: Geometry; moved: boolean; }
const HISTORY_LIMIT = 10;
const PAGE_RENDER_BUFFER = 2;

function PagePlaceholder({ page, scale, rotate }: { page: PDFPageProxy; scale: number; rotate: number }) {
  const viewport = page.getViewport({ scale, rotation: rotate });
  return <div style={{ width: viewport.width, height: viewport.height }} />;
}

export default function PdfViewer({ documentId, page, zoom, rotation, search, tool, color, undoRequest, redoRequest, onLoad, onReady, onLoadError, onPageChange, onMatches, onTextSelectionChange, onHistoryChange }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<{ page: number; x: number; y: number; currentX: number; currentY: number; points: { x: number; y: number }[] } | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<{ page: number; geometry: Annotation["geometry"] } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matchLocations, setMatchLocations] = useState<SearchMatch[]>([]);
  const annotationsRef = useRef<Annotation[]>([]);
  const undoHistoryRef = useRef<HistoryEntry[]>([]);
  const redoHistoryRef = useRef<HistoryEntry[]>([]);
  const noteDragRef = useRef<NoteDrag | null>(null);
  const historyBusyRef = useRef(false);
  const lastUndoRequestRef = useRef(undoRequest);
  const lastRedoRequestRef = useRef(redoRequest);
  const scrollPageRef = useRef<number | null>(null);
  const scrollAnchorRef = useRef<{ page: number; top: number } | null>(null);
  const navigationPageRef = useRef<number | null>(null);

  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);

  useEffect(() => {
    function handleSelectionChange() {
      const selection = document.getSelection();
      const container = containerRef.current;
      const anchor = selection?.anchorNode;
      const focus = selection?.focusNode;
      const isPdfSelection = Boolean(
        selection &&
        !selection.isCollapsed &&
        container &&
        anchor &&
        focus &&
        container.contains(anchor) &&
        container.contains(focus) &&
        (anchor.parentElement?.closest(".react-pdf__Page__textContent") || focus.parentElement?.closest(".react-pdf__Page__textContent")),
      );
      onTextSelectionChange(isPdfSelection ? selection!.toString() : "");
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      onTextSelectionChange("");
    };
  }, [onTextSelectionChange]);

  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/documents/${documentId}/annotations`).then((response) => response.ok ? response.json() : []).then((data) => {
      if (activeRequest) {
        setAnnotations(data);
        undoHistoryRef.current = [];
        redoHistoryRef.current = [];
        onHistoryChange(documentId, false, false);
        setSelectedId(null);
      }
    });
    return () => { activeRequest = false; };
  }, [documentId, onHistoryChange]);

  useEffect(() => {
    if (scrollPageRef.current === page) {
      scrollPageRef.current = null;
      return;
    }
    const target = containerRef.current?.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
    if (!target) return;
    navigationPageRef.current = page;
    let settleTimer: ReturnType<typeof setTimeout>;
    const alignTarget = () => {
      target.scrollIntoView({ behavior: "auto", block: "start" });
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (navigationPageRef.current === page) navigationPageRef.current = null;
      }, 150);
    };
    const documentElement = containerRef.current?.querySelector(".react-pdf__Document");
    const resizeObserver = new ResizeObserver(alignTarget);
    if (documentElement) resizeObserver.observe(documentElement);
    alignTarget();
    return () => {
      resizeObserver.disconnect();
      clearTimeout(settleTimer);
    };
  }, [page, pdf]);

  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    const container = containerRef.current;
    if (!anchor || anchor.page !== page || !container) return;
    const anchorPage = container.querySelector<HTMLElement>(`[data-page-number="${anchor.page}"]`);
    if (anchorPage) {
      const nextTop = anchorPage.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += nextTop - anchor.top;
    }
    scrollAnchorRef.current = null;
  }, [page]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdf) return;
    let animationFrame = 0;

    function updatePageFromScroll() {
      animationFrame = 0;
      if (navigationPageRef.current !== null) return;
      const containerBounds = container!.getBoundingClientRect();
      const renderedPages = container!.querySelectorAll<HTMLElement>(".pdf-page");
      let visiblePage = page;
      let visibleHeight = 0;

      renderedPages.forEach((renderedPage) => {
        const bounds = renderedPage.getBoundingClientRect();
        const height = Math.max(0, Math.min(bounds.bottom, containerBounds.bottom) - Math.max(bounds.top, containerBounds.top));
        const pageNumber = Number(renderedPage.dataset.pageNumber);
        if (height > visibleHeight && Number.isInteger(pageNumber)) {
          visibleHeight = height;
          visiblePage = pageNumber;
        }
      });

      if (visiblePage === page || visibleHeight === 0) return;
      const anchorPage = container!.querySelector<HTMLElement>(`[data-page-number="${visiblePage}"]`);
      if (!anchorPage) return;
      scrollAnchorRef.current = { page: visiblePage, top: anchorPage.getBoundingClientRect().top - containerBounds.top };
      scrollPageRef.current = visiblePage;
      onPageChange(visiblePage);
    }

    function handleScroll() {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePageFromScroll);
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [onPageChange, page, pdf]);

  useEffect(() => {
    if (!pdf || !search.query.trim()) { onMatches([]); return; }
    let cancelled = false;
    void (async () => {
      const flags = search.caseSensitive ? "g" : "gi";
      const source = `${search.wholeWord ? "\\b" : ""}${escapeRegExp(search.query.trim())}${search.wholeWord ? "\\b" : ""}`;
      const expression = new RegExp(source, flags);
      const found: SearchMatch[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        content.items.forEach((item, itemIndex) => {
          if (!("str" in item)) return;
          let occurrence = 0;
          for (const match of item.str.matchAll(expression)) {
            found.push({ page: pageNumber, text: match[0], itemIndex, occurrence });
            occurrence += 1;
          }
        });
      }
      if (!cancelled) { setMatchLocations(found); onMatches(found); }
    })();
    return () => { cancelled = true; };
  }, [pdf, search.query, search.wholeWord, search.caseSensitive, onMatches]);

  const highlight = useCallback(({ str, pageNumber, itemIndex }: { str: string; pageNumber: number; itemIndex: number }) => {
    if (!search.query.trim()) return str;
    const flags = search.caseSensitive ? "g" : "gi";
    const source = `${search.wholeWord ? "\\b" : ""}(${escapeRegExp(search.query.trim())})${search.wholeWord ? "\\b" : ""}`;
    let occurrence = 0;
    return str.replace(new RegExp(source, flags), (matched) => {
      const matchIndex = matchLocations.findIndex((item) => item.page === pageNumber && item.itemIndex === itemIndex && item.occurrence === occurrence);
      occurrence += 1;
      return `<mark${matchIndex === search.current ? ' class="search-current"' : ""}>${matched}</mark>`;
    });
  }, [matchLocations, search]);

  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }

  function clearPreviousTextSelection(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".react-pdf__Page__textContent")) return;
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
  }

  function startAnnotation(event: PointerEvent<HTMLDivElement>, pageNumber: number) {
    if (tool === "select") { setSelectedId(null); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    setDraft({ page: pageNumber, x: start.x, y: start.y, currentX: start.x, currentY: start.y, points: [start] });
  }

  async function finishAnnotation(event: PointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const end = point(event);
    const geometry = { x: Math.min(draft.x, end.x), y: Math.min(draft.y, end.y), w: Math.max(0.015, Math.abs(end.x - draft.x)), h: Math.max(0.015, Math.abs(end.y - draft.y)), ...(tool === "freehand" ? { points: [...draft.points, end] } : {}) };
    setDraft(null);
    if (tool === "note") {
      setPendingNote({ page: draft.page, geometry });
      setNoteText("");
      return;
    }
    await saveAnnotation({ page: draft.page, kind: tool as Annotation["kind"], color, geometry });
  }

  async function saveAnnotation(data: Omit<Annotation, "id">, recordHistory = true) {
    const response = await fetch(`/api/documents/${documentId}/annotations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (response.ok) {
      const saved: Annotation = await response.json();
      setAnnotations((current) => [...current, saved]);
      if (recordHistory) recordHistoryEntry({ type: "create", annotation: saved });
      return saved;
    }
    return null;
  }

  async function patchGeometry(id: string, geometry: Geometry) {
    const response = await fetch(`/api/documents/${documentId}/annotations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ geometry }) });
    if (!response.ok) return false;
    setAnnotations((current) => current.map((annotation) => annotation.id === id ? { ...annotation, geometry } : annotation));
    return true;
  }

  async function removeAnnotation(id: string, recordHistory = true) {
    const annotation = annotationsRef.current.find((item) => item.id === id);
    if (!annotation) return false;
    const response = await fetch(`/api/documents/${documentId}/annotations/${id}`, { method: "DELETE" });
    if (!response.ok) return false;
    setAnnotations((current) => current.filter((item) => item.id !== id));
    setSelectedId((current) => current === id ? null : current);
    setOpenNote((current) => current === id ? null : current);
    if (recordHistory) recordHistoryEntry({ type: "delete", annotation });
    return true;
  }

  function notifyHistoryChange() {
    onHistoryChange(documentId, Boolean(undoHistoryRef.current.length), Boolean(redoHistoryRef.current.length));
  }

  function pushHistory(stack: HistoryEntry[], entry: HistoryEntry) {
    stack.push(entry);
    if (stack.length > HISTORY_LIMIT) stack.splice(0, stack.length - HISTORY_LIMIT);
  }

  function recordHistoryEntry(entry: HistoryEntry) {
    pushHistory(undoHistoryRef.current, entry);
    redoHistoryRef.current = [];
    notifyHistoryChange();
  }

  function replaceEntryId(entry: HistoryEntry, previousId: string, nextId: string): HistoryEntry {
    if (entry.type === "move") return entry.id === previousId ? { ...entry, id: nextId } : entry;
    return entry.annotation.id === previousId ? { ...entry, annotation: { ...entry.annotation, id: nextId } } : entry;
  }

  function replaceHistoryId(previousId: string, nextId: string) {
    undoHistoryRef.current = undoHistoryRef.current.map((entry) => replaceEntryId(entry, previousId, nextId));
    redoHistoryRef.current = redoHistoryRef.current.map((entry) => replaceEntryId(entry, previousId, nextId));
  }

  async function undoLast() {
    if (historyBusyRef.current) return;
    const entry = undoHistoryRef.current.pop();
    if (!entry) return;
    historyBusyRef.current = true;
    let redoEntry = entry;
    let succeeded = false;
    try {
      if (entry.type === "create") succeeded = await removeAnnotation(entry.annotation.id, false);
      if (entry.type === "delete") {
        const restored = await saveAnnotation({ page: entry.annotation.page, kind: entry.annotation.kind, color: entry.annotation.color, geometry: entry.annotation.geometry, content: entry.annotation.content }, false);
        succeeded = Boolean(restored);
        if (restored) {
          replaceHistoryId(entry.annotation.id, restored.id);
          redoEntry = { ...entry, annotation: restored };
        }
      }
      if (entry.type === "move") succeeded = await patchGeometry(entry.id, entry.before);
      if (succeeded) pushHistory(redoHistoryRef.current, redoEntry);
      else pushHistory(undoHistoryRef.current, entry);
    } finally {
      historyBusyRef.current = false;
      notifyHistoryChange();
    }
  }

  async function redoLast() {
    if (historyBusyRef.current) return;
    const entry = redoHistoryRef.current.pop();
    if (!entry) return;
    historyBusyRef.current = true;
    let undoEntry = entry;
    let succeeded = false;
    try {
      if (entry.type === "create") {
        const restored = await saveAnnotation({ page: entry.annotation.page, kind: entry.annotation.kind, color: entry.annotation.color, geometry: entry.annotation.geometry, content: entry.annotation.content }, false);
        succeeded = Boolean(restored);
        if (restored) {
          replaceHistoryId(entry.annotation.id, restored.id);
          undoEntry = { ...entry, annotation: restored };
        }
      }
      if (entry.type === "delete") succeeded = await removeAnnotation(entry.annotation.id, false);
      if (entry.type === "move") succeeded = await patchGeometry(entry.id, entry.after);
      if (succeeded) pushHistory(undoHistoryRef.current, undoEntry);
      else pushHistory(redoHistoryRef.current, entry);
    } finally {
      historyBusyRef.current = false;
      notifyHistoryChange();
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editingText = target?.matches("input, textarea, [contenteditable='true']");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !editingText) {
        event.preventDefault();
        void undoLast();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y" && !editingText) {
        event.preventDefault();
        void redoLast();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !editingText) {
        event.preventDefault();
        void removeAnnotation(selectedId);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    if (lastUndoRequestRef.current !== undoRequest) {
      lastUndoRequestRef.current = undoRequest;
      void undoLast();
    }
    if (lastRedoRequestRef.current !== redoRequest) {
      lastRedoRequestRef.current = redoRequest;
      void redoLast();
    }
  });

  async function saveNote() {
    if (!pendingNote || !noteText.trim()) return;
    await saveAnnotation({ page: pendingNote.page, kind: "note", color, geometry: pendingNote.geometry, content: noteText.trim() });
    setPendingNote(null);
    setNoteText("");
  }

  function annotationStyle(annotation: Annotation) {
    return { left: `${annotation.geometry.x * 100}%`, top: `${annotation.geometry.y * 100}%`, width: `${annotation.geometry.w * 100}%`, height: `${annotation.geometry.h * 100}%`, borderColor: annotation.color, backgroundColor: annotation.kind === "highlight" || annotation.kind === "note" ? `${annotation.color}66` : "transparent" };
  }

  function stroke(annotation: Annotation) {
    const points = annotation.geometry.points ?? [];
    return <svg className={`annotation-stroke ${selectedId === annotation.id ? "selected" : ""}`} viewBox="0 0 1000 1000" preserveAspectRatio="none"><polyline points={points.map((item) => `${item.x * 1000},${item.y * 1000}`).join(" ")} fill="none" stroke={annotation.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents={tool === "select" ? "stroke" : "none"} onPointerDown={(event) => { if (tool === "select") { event.stopPropagation(); setSelectedId(annotation.id); } }} /></svg>;
  }

  function startNoteDrag(event: PointerEvent<HTMLButtonElement>, annotation: Annotation) {
    event.stopPropagation();
    setSelectedId(annotation.id);
    if (tool !== "select") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    noteDragRef.current = { id: annotation.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, before: annotation.geometry, current: annotation.geometry, moved: false };
  }

  function moveNote(event: PointerEvent<HTMLButtonElement>) {
    const drag = noteDragRef.current;
    const layer = event.currentTarget.closest<HTMLElement>(".drawing-layer");
    if (!drag || !layer) return;
    const bounds = layer.getBoundingClientRect();
    const distanceX = (event.clientX - drag.startX) / bounds.width;
    const distanceY = (event.clientY - drag.startY) / bounds.height;
    const geometry = { ...drag.before, x: Math.max(0, Math.min(1 - drag.before.w, drag.before.x + distanceX)), y: Math.max(0, Math.min(1 - drag.before.h, drag.before.y + distanceY)) };
    drag.moved ||= Math.abs(distanceX) > 0.002 || Math.abs(distanceY) > 0.002;
    drag.current = geometry;
    setAnnotations((current) => current.map((annotation) => annotation.id === drag.id ? { ...annotation, geometry } : annotation));
  }

  async function finishNoteDrag(event: PointerEvent<HTMLButtonElement>, annotation: Annotation) {
    event.stopPropagation();
    const drag = noteDragRef.current;
    noteDragRef.current = null;
    if (!drag?.moved) { setOpenNote(openNote === annotation.id ? null : annotation.id); return; }
    if (await patchGeometry(annotation.id, drag.current)) recordHistoryEntry({ type: "move", id: annotation.id, before: drag.before, after: drag.current });
    else setAnnotations((current) => current.map((item) => item.id === annotation.id ? { ...item, geometry: drag.before } : item));
  }

  function deleteButton(annotation: Annotation, pageAnchored = false) {
    const style = pageAnchored ? { left: `${annotation.geometry.x * 100}%`, top: `${annotation.geometry.y * 100}%` } : undefined;
    return selectedId === annotation.id && <button className="annotation-delete" style={style} title={t("pdf.removeAnnotation")} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void removeAnnotation(annotation.id); }}><Trash2 size={13} /></button>;
  }

  const renderedPages = pdf
    ? Array.from({ length: pdf.numPages }, (_, index) => index + 1)
    : [];

  return (
    <div className="pdf-scroll" ref={containerRef} onPointerDown={clearPreviousTextSelection}>
      <Document file={`/api/documents/${documentId}/file`} loading={<div className="viewer-message">{t("pdf.loading")}</div>} error={<div className="viewer-message error">{t("pdf.loadError")}</div>} onLoadSuccess={(loaded) => { setPdf(loaded); onLoad(loaded.numPages, loaded); }} onLoadError={onLoadError}>
        {renderedPages.map((pageNumber) => (
          <div className="pdf-page" data-page-number={pageNumber} key={pageNumber}>
            <span className="page-badge">{pageNumber}</span>
            <Page
              pageNumber={pageNumber}
              scale={zoom / 100}
              rotate={rotation}
              renderMode={Math.abs(pageNumber - page) <= PAGE_RENDER_BUFFER ? "canvas" : "none"}
              renderAnnotationLayer={Math.abs(pageNumber - page) <= PAGE_RENDER_BUFFER}
              renderTextLayer={Math.abs(pageNumber - page) <= PAGE_RENDER_BUFFER}
              customTextRenderer={highlight}
              onRenderSuccess={pageNumber === page ? onReady : undefined}
              onRenderError={onLoadError}
            >
              {Math.abs(pageNumber - page) > PAGE_RENDER_BUFFER
                ? ({ page: loadedPage, scale, rotate }) => <PagePlaceholder page={loadedPage} scale={scale} rotate={rotate} />
                : null}
            </Page>
            <div className={`drawing-layer ${tool !== "select" ? `drawing tool-${tool}` : ""}`} onPointerDown={(event) => startAnnotation(event, pageNumber)} onPointerMove={(event) => { if (draft?.page === pageNumber) { const current = point(event); setDraft({ ...draft, currentX: current.x, currentY: current.y, points: tool === "freehand" ? [...draft.points, current] : draft.points }); } }} onPointerUp={(event) => void finishAnnotation(event)}>
              {annotations.filter((annotation) => annotation.page === pageNumber).map((annotation) => annotation.kind === "freehand" ? <div className="annotation-freehand" key={annotation.id}>{stroke(annotation)}{deleteButton(annotation, true)}</div> : <div key={annotation.id} className={`annotation annotation-${annotation.kind} ${selectedId === annotation.id ? "selected" : ""}`} style={annotationStyle(annotation)} onPointerDown={(event) => { if (tool === "select") { event.stopPropagation(); setSelectedId(annotation.id); } }}>{annotation.kind === "note" && <button className="note-pin" title={tool === "select" ? t("pdf.moveAnnotation") : t("pdf.toggleAnnotation")} onPointerDown={(event) => startNoteDrag(event, annotation)} onPointerMove={moveNote} onPointerUp={(event) => void finishNoteDrag(event, annotation)}><MessageSquareText size={14} /></button>}{deleteButton(annotation)}{annotation.kind === "note" && openNote === annotation.id && <div className="note-content">{annotation.content}</div>}</div>)}
              {draft?.page === pageNumber && (tool === "freehand" ? stroke({ id: "draft", page: draft.page, kind: "freehand", color, geometry: { x: 0, y: 0, w: 1, h: 1, points: draft.points } }) : <div className={`annotation annotation-${tool} draft`} style={annotationStyle({ id: "draft", page: draft.page, kind: tool as Annotation["kind"], color, geometry: { x: Math.min(draft.x, draft.currentX), y: Math.min(draft.y, draft.currentY), w: Math.abs(draft.currentX - draft.x), h: Math.abs(draft.currentY - draft.y) } })} />)}
            </div>
          </div>
        ))}
      </Document>
      {pendingNote && <div className="note-editor" role="dialog" aria-label={t("pdf.annotationText")}><strong>{t("pdf.stickyNote")}</strong><textarea autoFocus maxLength={4000} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder={t("pdf.commentPlaceholder")} /><div><button onClick={() => setPendingNote(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={!noteText.trim()} onClick={() => void saveNote()}>{t("pdf.saveNote")}</button></div></div>}
    </div>
  );
}
