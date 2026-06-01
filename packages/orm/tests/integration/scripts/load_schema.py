#!/usr/bin/env python3
"""
Load JSON Schema 7 files emitted by @usetheo/orm and create equivalent
SQLAlchemy tables in an in-memory SQLite. Proof that the polyglot story
works (ADR D11 carry-over) — Python consumers can build a real ORM model
from the schemas TypeScript emits.

Usage:
  python3 load_schema.py <schema-dir>

Exit codes:
  0 — every schema loaded + Table.create succeeded
  1 — at least one schema failed (mapping unsupported or invalid)
  2 — usage error
"""

import json
import sys
from pathlib import Path

from sqlalchemy import (
    Column,
    Float,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Boolean,
    DateTime,
    create_engine,
)


JSON_TYPE_TO_SA = {
    "string": String,
    "integer": Integer,
    "number": Float,
    "boolean": Boolean,
    "object": String,  # JSON columns stored as text in SQLite
}


def map_column(name: str, schema: dict) -> Column:
    json_type = schema.get("type")
    json_format = schema.get("format")
    content_enc = schema.get("contentEncoding")

    if content_enc == "base64":
        return Column(name, LargeBinary)
    if json_format == "date-time":
        return Column(name, DateTime)
    if json_format == "uuid":
        return Column(name, String(36))
    if json_format == "int64":
        return Column(name, String(20))
    if json_format == "decimal":
        return Column(name, String(40))

    sa_type = JSON_TYPE_TO_SA.get(json_type)
    if sa_type is None:
        raise ValueError(
            f"Cannot map column {name!r} with type={json_type!r} format={json_format!r}"
        )
    if json_type == "string" and schema.get("maxLength"):
        return Column(name, String(int(schema["maxLength"])))
    return Column(name, sa_type)


def load_one(schema_path: Path, metadata: MetaData) -> str:
    payload = json.loads(schema_path.read_text())
    table_name = payload["title"]
    properties = payload.get("properties", {})
    columns = []
    for col_name, col_schema in properties.items():
        columns.append(map_column(col_name, col_schema))
    if not columns:
        raise ValueError(f"Table {table_name} has zero columns")
    # Mark a primary key — pick first matching id column or first column
    pk_col = next((c for c in columns if c.name == "id"), columns[0])
    pk_col.primary_key = True
    from sqlalchemy import Table

    Table(table_name, metadata, *columns)
    return table_name


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: load_schema.py <schema-dir>", file=sys.stderr)
        return 2

    schema_dir = Path(argv[1])
    if not schema_dir.is_dir():
        print(f"Not a directory: {schema_dir}", file=sys.stderr)
        return 2

    paths = sorted(schema_dir.glob("*.schema.json"))
    if not paths:
        print(f"No .schema.json files in {schema_dir}", file=sys.stderr)
        return 2

    metadata = MetaData()
    loaded: list[str] = []
    for p in paths:
        try:
            name = load_one(p, metadata)
            loaded.append(name)
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {p.name}: {exc}", file=sys.stderr)
            return 1

    engine = create_engine("sqlite:///:memory:")
    try:
        metadata.create_all(engine)
    except Exception as exc:  # noqa: BLE001
        print(f"create_all failed: {exc}", file=sys.stderr)
        return 1

    print(f"OK loaded {len(loaded)} table(s): {', '.join(loaded)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
