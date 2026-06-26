/** RFC 4180 cell escape with spreadsheet formula-injection neutralization. */
export function escapeCsvCell(value: string | number | null | undefined) {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function rowsToCsv(header: string[], rows: Array<Array<string | number | null | undefined>>) {
  return [header.join(","), ...rows.map((row) => row.map(escapeCsvCell).join(","))].join("\n");
}
