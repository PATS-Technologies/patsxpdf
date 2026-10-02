import "server-only";
import { cookies } from "next/headers";
import { defaultLocale, isLocale, localeCookie, translate, type Locale, type TranslationKey } from "@/lib/i18n";

export async function setLocaleCookie(locale: Locale) {
  (await cookies()).set(localeCookie, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export async function getRequestLocale() {
  const value = (await cookies()).get(localeCookie)?.value;
  return isLocale(value) ? value : defaultLocale;
}

export async function serverTranslate(key: TranslationKey, values?: Record<string, string | number>) {
  return translate(await getRequestLocale(), key, values);
}