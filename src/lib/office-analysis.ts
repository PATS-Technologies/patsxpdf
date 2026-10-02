import "server-only";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

const fontCatalogPath = process.env.OFFICE_FONT_CATALOG ?? "/data/font-catalog/families.txt";
const genericFonts = new Set(["sans-serif", "serif", "monospace", "system-ui"]);
let fontCatalogPromise: Promise<Set<string>> | undefined;

function normalizeFontName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function decodeXml(value: string) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function loadFontCatalog() {
  fontCatalogPromise ??= readFile(/* turbopackIgnore: true */ fontCatalogPath, "utf8").then((contents) => new Set(
    contents
      .split(/\r?\n|,/)
      .map(normalizeFontName)
      .filter(Boolean),
  ));
  return fontCatalogPromise;
}

function collectMatches(xml: string, expression: RegExp, values: Set<string>) {
  for (const match of xml.matchAll(expression)) {
    const value = decodeXml(match[1]).trim();
    if (value && !value.startsWith("+")) values.add(value);
  }
}

export interface OfficeDiagnostics {
  missingFonts: string[];
  externalReferences: string[];
}

export async function analyzeOfficeDocument(bytes: Uint8Array): Promise<OfficeDiagnostics> {
  const archive = unzipSync(bytes);
  const referencedFonts = new Set<string>();
  const externalReferences = new Set<string>();

  for (const [name, contents] of Object.entries(archive)) {
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const xml = strFromU8(contents);

    collectMatches(xml, /<w:font\b[^>]*\bw:name="([^"]+)"/g, referencedFonts);
    collectMatches(xml, /<w:rFonts\b[^>]*\bw:(?:ascii|hAnsi|eastAsia|cs)="([^"]+)"/g, referencedFonts);
    collectMatches(xml, /<a:(?:latin|ea|cs)\b[^>]*\btypeface="([^"]+)"/g, referencedFonts);
    if (name === "xl/styles.xml") collectMatches(xml, /<name\b[^>]*\bval="([^"]+)"/g, referencedFonts);

    if (name.endsWith(".rels")) {
      for (const relationship of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        const attributes = relationship[1];
        if (!/\bTargetMode=(["'])External\1/i.test(attributes)) continue;
        const target = attributes.match(/\bTarget=(["'])(.*?)\1/i);
        if (target) externalReferences.add(decodeXml(target[2]));
      }
    }
  }

  const availableFonts = await loadFontCatalog();
  const missingFonts = [...referencedFonts]
    .filter((font) => {
      const normalized = normalizeFontName(font);
      return !genericFonts.has(normalized) && !availableFonts.has(normalized);
    })
    .sort((left, right) => left.localeCompare(right));

  return {
    missingFonts,
    externalReferences: [...externalReferences].sort((left, right) => left.localeCompare(right)),
  };
}
