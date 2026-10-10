"use client";

import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

interface ComparisonResultProps {
  jobId: string;
  baseUrl: string | null;
  onClose: () => void;
}

const compareLocales = new Set(["pt", "en", "es"]);

export function ComparisonResult({ jobId, baseUrl, onClose }: ComparisonResultProps) {
  const { t, locale } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const handleMessage = useCallback((event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data && typeof data === "object" && data.type === "patsxpdf:close-comparison") onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // ESC fecha a comparação quando o foco está na página pai.
  // Quando o foco está dentro do iframe, o ESC é tratado pela página do
  // resultado em si, que envia a mensagem "patsxpdf:close-comparison".
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const primaryLocale = locale.split("-")[0];
  const resultLocale = compareLocales.has(primaryLocale) ? primaryLocale : "en";
  const src = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/result/${jobId}?embed=1&locale=${resultLocale}` : null;

  // Coloca o foco dentro do iframe para que as teclas (ex.: ESC) cheguem
  // imediatamente à página do resultado.
  useEffect(() => {
    if (src) iframeRef.current?.focus();
  }, [src]);

  return (
    <div className="comparison-view">
      <div className="comparison-bar">
        <strong>{t("compare.resultTitle")}</strong>
        <button className="secondary-button" onClick={onClose}>
          <X size={15} />{t("common.close")}
        </button>
      </div>
      {src
        ? <iframe ref={iframeRef} className="comparison-frame" src={src} title={t("compare.resultTitle")} />
        : <div className="empty-state"><p>{t("compare.resultUnavailable")}</p></div>}
    </div>
  );
}
