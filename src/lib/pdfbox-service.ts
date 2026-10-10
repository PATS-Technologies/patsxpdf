import "server-only";

const serviceUrl = process.env.ENGINE_SERVICE_URL ?? "http://engine:8080";
const serviceToken = process.env.ENGINE_API_TOKEN ?? "development-only-change-me";
const requestTimeoutMs = Number(process.env.ENGINE_REQUEST_TIMEOUT_MS ?? 300_000);

export const ocrLanguageCodes = ["por", "eng", "spa", "fra"] as const;
export type OcrLanguageCode = typeof ocrLanguageCodes[number];

export interface OcrJobStatus {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "ERROR";
  mode: "page" | "full";
  languages: string;
  page: number | null;
  totalPages: number;
  processedPages: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class PdfboxServiceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PdfboxServiceError";
  }
}

export function parseOcrLanguages(value: unknown): OcrLanguageCode[] {
  const requested = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,+]/)
      : [...ocrLanguageCodes];
  const normalized = [...new Set(requested.map((language) => String(language).trim().toLowerCase()).filter(Boolean))];
  if (!normalized.length || normalized.some((language) => !ocrLanguageCodes.includes(language as OcrLanguageCode))) {
    throw new PdfboxServiceError(`Supported OCR languages: ${ocrLanguageCodes.join(", ")}.`, 400);
  }
  return normalized as OcrLanguageCode[];
}

function serviceHeaders() {
  return { "X-API-Token": serviceToken };
}

async function serviceFetch(pathname: string, init: RequestInit = {}) {
  const signal = AbortSignal.timeout(requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${serviceUrl}${pathname}`, {
      ...init,
      headers: { ...serviceHeaders(), ...init.headers },
      signal,
    });
  } catch (error) {
    throw new PdfboxServiceError(error instanceof Error ? error.message : String(error), 502);
  }
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: string; detail?: string };
      message = parsed.error ?? parsed.detail ?? body;
    } catch {
      // The service may return plain text for infrastructure failures.
    }
    throw new PdfboxServiceError(message || `PDFBox service returned HTTP ${response.status}.`, response.status >= 500 ? 502 : response.status);
  }
  return response;
}

function ocrForm(jobId: string, file: File, languages: OcrLanguageCode[]) {
  const form = new FormData();
  form.set("jobId", jobId);
  form.set("languages", languages.join("+"));
  form.set("file", file);
  return form;
}

export async function ocrPage(jobId: string, file: File, page: number, languages: OcrLanguageCode[]) {
  const form = ocrForm(jobId, file, languages);
  form.set("page", String(page));
  const response = await serviceFetch("/v1/ocr/page", { method: "POST", body: form });
  return response.json() as Promise<{ job: OcrJobStatus; text: string }>;
}

export async function submitOcrJob(jobId: string, file: File, languages: OcrLanguageCode[]) {
  const response = await serviceFetch("/v1/ocr/jobs", { method: "POST", body: ocrForm(jobId, file, languages) });
  return response.json() as Promise<OcrJobStatus>;
}

export async function getOcrJob(jobId: string) {
  const response = await serviceFetch(`/v1/ocr/jobs/${encodeURIComponent(jobId)}`);
  return response.json() as Promise<OcrJobStatus>;
}

export async function getOcrArtifact(jobId: string, artifact: "pdf" | "text" | "json") {
  return serviceFetch(`/v1/ocr/jobs/${encodeURIComponent(jobId)}/${artifact}`);
}

function extractionForm(jobId: string, file: File, languages: OcrLanguageCode[]) {
  return ocrForm(jobId, file, languages);
}

export async function extractSinglePage(jobId: string, file: File, page: number, languages: OcrLanguageCode[]) {
  const form = extractionForm(jobId, file, languages);
  form.set("page", String(page));
  const response = await serviceFetch("/v1/extractions/page", { method: "POST", body: form });
  return response.json() as Promise<{ job: OcrJobStatus; text: string; json: string }>;
}

export async function submitExtractionJob(jobId: string, file: File, pages: number[], languages: OcrLanguageCode[]) {
  const form = extractionForm(jobId, file, languages);
  form.set("pages", pages.join(","));
  const response = await serviceFetch("/v1/extractions/jobs", { method: "POST", body: form });
  return response.json() as Promise<OcrJobStatus>;
}

export async function getExtractionArtifact(jobId: string, artifact: "text" | "json") {
  return serviceFetch(`/v1/ocr/jobs/${encodeURIComponent(jobId)}/${artifact}`);
}
