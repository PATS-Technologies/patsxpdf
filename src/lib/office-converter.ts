import "server-only";

const officeConverterUrl = process.env.OFFICE_CONVERTER_URL ?? "http://office:3000";
const conversionTimeoutMs = Number(process.env.OFFICE_CONVERTER_TIMEOUT_MS ?? 120_000);

export class OfficeConversionError extends Error {
  constructor(
    readonly reason: "unavailable" | "failed",
    readonly details: string,
    options?: ErrorOptions,
  ) {
    super(`Office conversion ${reason}`, options);
    this.name = "OfficeConversionError";
  }
}

export async function convertOfficeToPdf(file: File) {
  const form = new FormData();
  form.set("files", file, file.name);

  let response: Response;
  try {
    response = await fetch(`${officeConverterUrl}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(conversionTimeoutMs),
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new OfficeConversionError("unavailable", details, { cause: error });
  }

  if (!response.ok) {
    const details = await response.text();
    console.error(`LibreOffice conversion failed (${response.status}): ${details}`);
    const trace = response.headers.get("Gotenberg-Trace");
    throw new OfficeConversionError("failed", [
      `HTTP ${response.status}`,
      trace ? `Gotenberg-Trace: ${trace}` : "",
      details.trim(),
    ].filter(Boolean).join("\n"));
  }

  return new Uint8Array(await response.arrayBuffer());
}
