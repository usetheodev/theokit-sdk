import type { Column, Table } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { OrmSchemaExportError } from "./errors.js";

export type JsonSchema7 = {
  $schema?: string;
  title?: string;
  type: "object";
  properties: Record<string, JsonSchema7Property>;
  required: string[];
  additionalProperties: false;
};

export type JsonSchema7Property = {
  type?: "string" | "integer" | "number" | "boolean" | "object" | "array" | "null";
  format?: string;
  maxLength?: number;
  multipleOf?: number;
  default?: unknown;
  enum?: ReadonlyArray<string | number>;
  contentEncoding?: string;
  "x-check"?: string;
  description?: string;
};

interface ColumnInternal {
  dataType?: string;
  columnType?: string;
  notNull?: boolean;
  hasDefault?: boolean;
  default?: unknown;
  defaultFn?: () => unknown;
  enumValues?: ReadonlyArray<string>;
  length?: number;
  precision?: number;
  scale?: number;
  primary?: boolean;
  isPrimaryKey?: boolean;
  primaryKey?: boolean;
}

function tableNameOf(table: unknown): string {
  if (table === null || typeof table !== "object") return "<unknown>";
  const sym = (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")];
  if (typeof sym === "string") return sym;
  const inner = (table as { _?: { name?: string } })._;
  return inner?.name ?? "<unknown>";
}

function lower(s: string | undefined): string {
  return (s ?? "").toLowerCase();
}

function isInteger(dataType: string, columnType: string): boolean {
  if (dataType === "number" && /int/.test(columnType)) return true;
  if (dataType === "integer") return true;
  return false;
}

function mapColumnToJsonSchema(
  colName: string,
  col: Column,
  tableName: string,
): JsonSchema7Property {
  const meta = col as unknown as ColumnInternal;
  const dt = lower(meta.dataType);
  const ct = lower(meta.columnType);

  if (Array.isArray(meta.enumValues) && meta.enumValues.length > 0) {
    return { type: "string", enum: [...meta.enumValues] };
  }

  if (/uuid/.test(ct)) {
    return { type: "string", format: "uuid" };
  }

  if (/numeric|decimal/.test(ct)) {
    const out: JsonSchema7Property = { type: "string", format: "decimal" };
    if (typeof meta.scale === "number" && meta.scale >= 0) {
      out.multipleOf = 10 ** -meta.scale;
    }
    return out;
  }

  if (/bigint/.test(ct)) {
    return { type: "string", format: "int64" };
  }

  if (dt === "date" || /timestamp|date/.test(ct)) {
    return { type: "string", format: "date-time" };
  }

  if (/blob|bytea|binary/.test(ct)) {
    return { type: "string", contentEncoding: "base64" };
  }

  if (dt === "boolean" || /boolean|bool/.test(ct)) {
    return { type: "boolean" };
  }

  if (dt === "json" || /json/.test(ct)) {
    return { type: "object" };
  }

  if (isInteger(dt, ct)) {
    return { type: "integer" };
  }

  if (dt === "number" || /real|double|float/.test(ct)) {
    return { type: "number" };
  }

  if (dt === "string" || /text|varchar|char/.test(ct)) {
    const out: JsonSchema7Property = { type: "string" };
    if (typeof meta.length === "number" && meta.length > 0) out.maxLength = meta.length;
    return out;
  }

  throw new OrmSchemaExportError(
    `Cannot export column "${colName}" of table "${tableName}": unknown type (dataType="${meta.dataType}", columnType="${meta.columnType}"). Add to mapColumnToJsonSchema or use the "_excludeFromExport: true" annotation.`,
  );
}

export function exportSchema(table: Table): JsonSchema7 {
  const tableName = tableNameOf(table);
  const columns = getTableColumns(table) as Record<string, Column>;

  const properties: Record<string, JsonSchema7Property> = {};
  const required: string[] = [];

  for (const [colName, col] of Object.entries(columns)) {
    const meta = col as unknown as ColumnInternal;
    const prop = mapColumnToJsonSchema(colName, col, tableName);

    if (meta.hasDefault === true) {
      if (meta.default !== undefined) {
        prop.default = meta.default;
      }
    }

    if (meta.notNull === true && meta.hasDefault !== true) {
      required.push(colName);
    }

    properties[colName] = prop;
  }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: tableName,
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function exportSchemas(schema: Record<string, Table>): Record<string, JsonSchema7> {
  const out: Record<string, JsonSchema7> = {};
  for (const [, table] of Object.entries(schema)) {
    const name = tableNameOf(table);
    out[name] = exportSchema(table);
  }
  return out;
}
