#!/usr/bin/env python3
"""Check catalog coverage and interpolation types for the supported iOS languages."""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FORMAT = re.compile(r"%(?:(\d+)\$)?([-+ #0]*\d*(?:\.\d+)?)(ll|l|h|hh|z|t|j)?([@diuoxXfFeEgGcCsSp%])")


def arguments(value):
    result = {}
    next_index = 1
    for match in FORMAT.finditer(value):
        position, _, size, kind = match.groups()
        if kind == "%":
            continue
        index = int(position) if position else next_index
        next_index += 1
        result[index] = (size or "", kind)
    return result


def units(node, path=()):
    if "stringUnit" in node:
        yield path, node["stringUnit"]
    for name, child in node.items():
        if isinstance(child, dict) and name != "stringUnit":
            yield from units(child, (*path, name))


def check(derived_data=None):
    language_source = (ROOT / "Kualia/App/AppLanguage.swift").read_text()
    language_enum = language_source.split("static let defaultsKey", 1)[0]
    languages = re.findall(r'case \w+ = "([a-zA-Z-]+)"', language_enum)
    if not languages or "en" not in languages:
        raise ValueError("Could not read supported app languages")
    failures = []
    checked = 0
    tables = {}
    for catalog_path in sorted((ROOT / "Kualia").glob("*.xcstrings")):
        catalog = json.loads(catalog_path.read_text())
        tables[catalog_path.stem] = catalog["strings"]
        for key, entry in catalog["strings"].items():
            if entry.get("shouldTranslate") is False:
                continue
            checked += 1
            expected = arguments(key)
            for language in languages:
                label = f"{catalog_path.name}: {key!r} [{language}]"
                localized = entry.get("localizations", {}).get(language, {})
                translations = list(units(localized))
                if not translations:
                    failures.append(f"{label}: missing translation")
                for path, unit in translations:
                    value = unit.get("value", "")
                    if not value.strip() or unit.get("state") != "translated":
                        failures.append(f"{label}: empty or unfinished translation")
                    actual = arguments(value)
                    # Some plural forms express zero, one, or two in words.
                    optional_count = "plural" in path and path[-1] in {"zero", "one", "two"}
                    omitted = set(expected) - set(actual)
                    allowed_omission = optional_count and all(
                        expected[index][1] in "diu" for index in omitted
                    )
                    if any(expected.get(index) != kind for index, kind in actual.items()) or (
                        omitted and not allowed_omission
                    ):
                        failures.append(f"{label} {'/'.join(path)}: interpolation mismatch")
    if derived_data:
        intermediates = derived_data / "Build/Intermediates.noindex/Kualia.build/Debug-iphoneos"
        for target in ("Kualia", "KualiaWidgetsExtension"):
            files = list((intermediates / f"{target}.build/Objects-normal/arm64").glob("*.stringsdata"))
            if not files:
                failures.append(f"No compiler-extracted strings for {target}; build Debug first")
            for source in files:
                extracted = json.loads(source.read_text())
                for table, entries in extracted.get("tables", {}).items():
                    for entry in entries:
                        key = entry["key"]
                        if key not in tables.get(table, {}):
                            failures.append(f"{source.name}: {key!r} is missing from {table}.xcstrings")
    return languages, checked, sorted(set(failures))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--derived-data", type=Path, help="Also audit strings extracted by a Debug generic-device build")
    args = parser.parse_args()
    languages, checked, failures = check(args.derived_data)
    if failures:
        print("\n".join(failures))
        raise SystemExit(1)
    print(f"Checked {checked} strings in {len(languages)} languages: no missing translations or interpolation mismatches.")
