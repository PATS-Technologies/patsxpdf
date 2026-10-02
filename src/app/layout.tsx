import type { Metadata } from "next";
import { Geist, Rajdhani } from "next/font/google";
import { cookies } from "next/headers";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { I18nProvider } from "@/components/I18nProvider";
import { defaultLocale, isLocale, localeCookie } from "@/lib/i18n";
import "./globals.css";

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PATSXPDF Viewer",
  description: "Visualizador e revisor de documentos PDF",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const savedLocale = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(savedLocale) ? savedLocale : defaultLocale;
  return (
    <html lang={locale} className={`${rajdhani.variable} ${geist.variable}`}>
      <body><I18nProvider initialLocale={locale}>{children}</I18nProvider></body>
    </html>
  );
}
