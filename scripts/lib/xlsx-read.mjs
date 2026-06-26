import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON = join(__dirname, "read_xlsx_sheet.py");

export function readXlsxTab(xlsxPath, sheetName, headerRow) {
  const output = execFileSync("python3", [PYTHON, xlsxPath, sheetName, String(headerRow)], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(output);
}
