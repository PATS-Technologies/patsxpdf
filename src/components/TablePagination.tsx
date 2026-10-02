"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

const pageSize = 100;

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function useEscape(onEscape: () => void, active = true, ignoreWhenModalOpen = false) {
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (ignoreWhenModalOpen && document.querySelector("dialog[open], .modal-backdrop")) return;
      event.preventDefault();
      onEscape();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, ignoreWhenModalOpen, onEscape]);
}

export function usePaginatedItems<T>({
  items,
  active = true,
  allowInModal = false,
  selectedIndex = -1,
  onSelectIndex,
}: {
  items: T[];
  active?: boolean;
  allowInModal?: boolean;
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
}) {
  const [requestedPage, setRequestedPage] = useState(1);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);

  const scrollTo = useCallback((selector: string) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        container?.querySelector(selector)?.scrollIntoView({ block: "nearest" });
      });
    });
  }, [container]);

  const setPage = useCallback((nextPage: number) => {
    const targetPage = Math.max(1, Math.min(pageCount, nextPage));
    setRequestedPage(targetPage);
    const firstIndex = (targetPage - 1) * pageSize;
    if (items[firstIndex]) onSelectIndex?.(firstIndex);
    scrollTo("tbody tr:first-child");
  }, [items, onSelectIndex, pageCount, scrollTo]);

  useEffect(() => {
    if (!active) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (!allowInModal && document.querySelector("dialog[open], .modal-backdrop")) return;

      if (event.key === "PageDown" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        setPage(page + 1);
      } else if (event.key === "PageUp" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        setPage(page - 1);
      } else if (event.ctrlKey && event.key === "Home") {
        event.preventDefault();
        setPage(1);
      } else if (event.ctrlKey && event.key === "End") {
        event.preventDefault();
        setRequestedPage(pageCount);
        if (items.length) onSelectIndex?.(items.length - 1);
        scrollTo("tbody tr:last-child");
      } else if (event.key === "ArrowDown" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        const nextIndex = Math.min(items.length - 1, Math.max(0, selectedIndex + 1));
        if (nextIndex >= 0) {
          setRequestedPage(Math.floor(nextIndex / pageSize) + 1);
          onSelectIndex?.(nextIndex);
          scrollTo("tbody tr.selected");
        }
      } else if (event.key === "ArrowUp" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        const previousIndex = Math.max(0, selectedIndex < 0 ? 0 : selectedIndex - 1);
        if (items.length) {
          setRequestedPage(Math.floor(previousIndex / pageSize) + 1);
          onSelectIndex?.(previousIndex);
          scrollTo("tbody tr.selected");
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, allowInModal, items, onSelectIndex, page, pageCount, scrollTo, selectedIndex, setPage]);

  return { page, pageCount, pageItems, setContainer, setPage };
}

export function TablePagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useI18n();
  return <nav className="table-pagination" aria-label={t("pagination.navigation")}>
    <button disabled={page === 1} title={t("pagination.previous")} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} />{t("pagination.previous")}</button>
    <span>{t("pagination.page", { page, total: pageCount })}</span>
    <button disabled={page === pageCount} title={t("pagination.next")} onClick={() => onPageChange(page + 1)}>{t("pagination.next")}<ChevronRight size={15} /></button>
  </nav>;
}
