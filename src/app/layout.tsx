import type { Metadata } from "next";
import { Rajdhani } from "next/font/google";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./globals.css";

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PatsXPDF Viewer",
  description: "Visualizador e revisor de documentos PDF",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={rajdhani.variable}>
      <body>{children}</body>
    </html>
  );
}
