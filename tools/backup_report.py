#!/usr/bin/env python3
"""Count records in a Vilod HH backup without exporting their contents."""
import argparse
import csv
import json
from pathlib import Path
import sys

MAX_BYTES = 15_000_000


def summarize(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Backup exceeds 15 MB")
    backup = json.loads(data.decode("utf-8-sig"))
    if (not isinstance(backup, dict) or backup.get("format") != "vilod-hh-backup"
            or type(backup.get("version")) is not int or backup["version"] != 1):
        raise ValueError("Unsupported backup format")
    state = backup.get("state")
    if not isinstance(state, dict) or type(state.get("schema")) is not int or state["schema"] != 1:
        raise ValueError("Unsupported backup state")
    counts = {}
    for field, expected in (
        ("cards", dict), ("companies", dict), ("questions", dict), ("jobs", list),
        ("history", dict), ("analysisRequests", dict), ("analysisReplies", dict),
        ("operatorReports", dict), ("existingResponses", dict),
    ):
        default = None if field in {"cards", "companies", "questions", "jobs"} else expected()
        records = state.get(field, default)
        if not isinstance(records, expected):
            raise ValueError(f"Invalid backup field: {field}")
        counts[field] = len(records)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--csv", type=Path, help="Write counts to a new UTF-8 CSV")
    args = parser.parse_args()
    try:
        counts = summarize(args.backup)
        if args.csv:
            with args.csv.open("x", encoding="utf-8-sig", newline="") as output:
                writer = csv.writer(output)
                writer.writerow(["category", "count"])
                writer.writerows(counts.items())
        else:
            print(json.dumps(counts, indent=2))
    except (OSError, UnicodeError, ValueError):
        print("Could not read a supported backup or create the requested new CSV.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
