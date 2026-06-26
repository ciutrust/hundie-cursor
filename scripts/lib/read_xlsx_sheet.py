#!/usr/bin/env python3
"""Read one sheet from xlsx as JSON array of row dicts. Usage: read_xlsx_sheet.py <path> <sheet> <header_row_1based>"""
import json, sys, zipfile, xml.etree.ElementTree as ET, re
from collections import defaultdict

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

def col_idx(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n

def main():
    path, sheet_name, header_row = sys.argv[1], sys.argv[2], int(sys.argv[3])
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rid = next(
            sh.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            for sh in wb.find(f"{NS}sheets")
            if sh.attrib.get("name") == sheet_name
        )
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = "xl/" + next(rel.attrib["Target"] for rel in rels if rel.attrib["Id"] == rid).lstrip("/")
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in sst.findall(f"{NS}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
        root = ET.fromstring(z.read(target))
        rows = defaultdict(dict)
        for c in root.iter(f"{NS}c"):
            m = re.match(r"([A-Z]+)(\d+)", c.attrib.get("r", ""))
            if not m:
                continue
            v = c.find(f"{NS}v")
            if v is None or v.text is None:
                continue
            val = shared[int(v.text)] if c.attrib.get("t") == "s" else v.text
            rows[int(m.group(2))][m.group(1)] = val

    header_cols = sorted(rows[header_row].keys(), key=col_idx)
    headers = [str(rows[header_row].get(c, "")).strip() for c in header_cols]
    records = []
    for r in range(header_row + 1, max(rows) + 1):
        rec = {}
        has = False
        for i, col in enumerate(header_cols):
            h = headers[i]
            if not h:
                continue
            val = rows[r].get(col, "")
            if val is not None and str(val).strip():
                has = True
            rec[h] = "" if val is None else str(val).strip()
        if has:
            records.append(rec)
    print(json.dumps({"headers": headers, "records": records}))

if __name__ == "__main__":
    main()
