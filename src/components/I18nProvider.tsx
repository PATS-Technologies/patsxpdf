"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { dictionaries, type Locale, locales, type TranslationKey } from "@/lib/i18n";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale, persist?: boolean) => Promise<void>;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatDate: (value: string | Date) => string;
  formatNumber: (value: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [locale, updateLocale] = useState(initialLocale);

  async function setLocale(nextLocale: Locale, persist = true) {
    updateLocale(nextLocale);
    if (persist) {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
    }
    router.refresh();
  }

  function t(key: TranslationKey, values: Record<string, string | number> = {}) {
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dictionaries[locale][key]);
  }

  return <I18nContext.Provider value={{ locale, setLocale, t, formatDate: (value) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(value)), formatNumber: (value) => new Intl.NumberFormat(locale).format(value) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`locale-switcher ${compact ? "compact" : ""}`}>
      {!compact && <span>{t("language.label")}</span>}
      <select aria-label={t("language.label")} value={locale} onChange={(event) => void setLocale(event.target.value as Locale)}>
        {locales.map((item) => <option key={item} value={item}>{t(`language.${item}` as TranslationKey)}</option>)}
      </select>
    </label>
  );
}