function csvValue(value: unknown) {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const contents = [headers, ...rows].map((row) => row.map(csvValue).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
