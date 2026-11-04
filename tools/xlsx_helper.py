#!/usr/bin/env python3
"""Minimal XLSX bridge for the dsh-project-todo plugin (openpyxl required).

Usage:
  python xlsx_helper.py export <payload.json> <out.xlsx>
  python xlsx_helper.py import <in.xlsx>
"""
import json
import sys

import openpyxl
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter


def do_export(payload_path, output_path):
    with open(payload_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    headers = payload["headers"]
    rows = payload["rows"]
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = payload.get("sheet", "todos")
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.alignment = Alignment(vertical="center")
    for row in rows:
        sheet.append([row.get(header, "") for header in headers])
    for index, header in enumerate(headers, start=1):
        width = max(10, min(48, len(str(header)) + 8))
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = "A2"
    workbook.save(output_path)


def do_import(path):
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    sheet = workbook.active
    rows = []
    headers = None
    for values in sheet.iter_rows(values_only=True):
        if headers is None:
            headers = ["" if value is None else str(value).strip() for value in values]
            continue
        if not any(value not in (None, "") for value in values):
            continue
        record = {}
        for index, header in enumerate(headers):
            if not header:
                continue
            value = values[index] if index < len(values) else None
            if value is None:
                record[header] = ""
            elif isinstance(value, (str, int, float, bool)):
                record[header] = str(value) if not isinstance(value, bool) else ("true" if value else "false")
            else:
                record[header] = str(value)
        rows.append(record)
    print(json.dumps(rows, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: xlsx_helper.py export <payload.json> <out.xlsx> | import <in.xlsx>")
    if sys.argv[1] == "export" and len(sys.argv) >= 4:
        do_export(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "import" and len(sys.argv) >= 3:
        do_import(sys.argv[2])
    else:
        raise SystemExit("bad arguments")
