#!/usr/bin/env python3
"""Compare two UTF-8 CSV exports by a unique column and summarize changes."""
import argparse
import csv
import json
from pathlib import Path
import sys


def load_table(path, key, delimiter):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream, delimiter=delimiter, strict=True)
        columns = next(reader, [])
        if not columns or any(not column.strip() for column in columns) or len(set(columns)) != len(columns):
            raise ValueError("The header must contain unique, nonempty columns.")
        if key not in columns:
            raise ValueError("The key column is missing.")
        key_index = columns.index(key)
        rows = {}
        for row in reader:
            if not row:
                continue
            if len(row) != len(columns):
                raise ValueError(f"Wrong field count at line {reader.line_num}.")
            identity = row[key_index]
            if not identity.strip() or identity in rows:
                raise ValueError(f"Empty or duplicate key at line {reader.line_num}.")
            rows[identity] = dict(zip(columns, row))
        return columns, rows


def compare(before, after, key, delimiter):
    old_columns, old_rows = load_table(before, key, delimiter)
    new_columns, new_rows = load_table(after, key, delimiter)
    common_columns = [column for column in new_columns if column in old_columns and column != key]
    field_changes = dict.fromkeys(common_columns, 0)
    changed = 0
    shared = old_rows.keys() & new_rows.keys()
    for identity in shared:
        different = False
        for column in common_columns:
            if old_rows[identity][column] != new_rows[identity][column]:
                field_changes[column] += 1
                different = True
        changed += int(different)
    totals = {
        "added_rows": len(new_rows.keys() - old_rows.keys()),
        "removed_rows": len(old_rows.keys() - new_rows.keys()),
        "changed_rows": changed,
        "unchanged_rows": len(shared) - changed,
        "added_columns": len(set(new_columns) - set(old_columns)),
        "removed_columns": len(set(old_columns) - set(new_columns)),
    }
    return totals, field_changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--key", required=True, help="Unique column name, e.g. id")
    parser.add_argument("--delimiter", choices=["comma", "semicolon", "tab"], default="comma")
    parser.add_argument("--out", type=Path, help="Write a new spreadsheet-ready CSV")
    args = parser.parse_args()
    try:
        totals, fields = compare(args.before, args.after, args.key,
                                 {"comma": ",", "semicolon": ";", "tab": "\t"}[args.delimiter])
        if args.out:
            with args.out.open("x", encoding="utf-8-sig", newline="") as output:
                writer = csv.writer(output)
                writer.writerow(["metric", "count"])
                writer.writerows(totals.items())
                # A fixed prefix makes exported column names plain text in spreadsheets.
                writer.writerows((f"column: {name}", count) for name, count in fields.items())
        else:
            print(json.dumps({"totals": totals, "changed_cells_by_column": fields}, ensure_ascii=False, indent=2))
    except (OSError, UnicodeError, csv.Error):
        print("Could not read UTF-8 CSV or create the requested new report.", file=sys.stderr)
        return 1
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
