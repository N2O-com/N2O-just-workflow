/**
 * SQL schema parser for the Ontology graph.
 *
 * Parses CREATE TABLE, CREATE INDEX, ALTER TABLE, and CREATE POLICY
 * statements from SQL files. Outputs IntrospectionType[] compatible
 * with parseSchemaToGraph() plus PgTableMetadata for each table.
 */

import type { IntrospectionType, IntrospectionTypeRef } from "./schema-parser";
import type { PgTableMetadata, PgConstraint, PgIndex, PgRlsPolicy } from "./pg-types";

export interface SqlParseResult {
  types: IntrospectionType[];
  metadata: Map<string, PgTableMetadata>;
}

// ── SQL type → IntrospectionTypeRef mapping ─────────────

const INT_TYPES = new Set([
  "INTEGER", "INT", "BIGINT", "SMALLINT", "SERIAL", "BIGSERIAL", "TINYINT", "MEDIUMINT",
]);
const FLOAT_TYPES = new Set([
  "REAL", "FLOAT", "DOUBLE", "NUMERIC", "DECIMAL",
]);
const BOOL_TYPES = new Set(["BOOLEAN", "BOOL"]);
const STRING_TYPES = new Set([
  "TEXT", "VARCHAR", "CHAR", "CHARACTER", "CLOB",
  "TIMESTAMP", "TIMESTAMPTZ", "DATE", "TIME", "DATETIME",
  "JSONB", "JSON", "UUID", "BYTEA", "BLOB",
]);

function mapSqlType(rawType: string): IntrospectionTypeRef {
  // Normalize: strip parenthetical (VARCHAR(255) → VARCHAR), uppercase
  const base = rawType.replace(/\(.*\)/, "").trim().toUpperCase();

  // Handle "DOUBLE PRECISION"
  const normalized = base === "DOUBLE PRECISION" ? "DOUBLE" : base;

  // Handle array types: TEXT[] → LIST of String
  if (rawType.trim().endsWith("[]")) {
    const innerType = rawType.replace("[]", "").trim();
    return {
      name: null,
      kind: "LIST",
      ofType: mapSqlType(innerType),
    };
  }

  if (INT_TYPES.has(normalized)) return { name: "Int", kind: "SCALAR", ofType: null };
  if (FLOAT_TYPES.has(normalized)) return { name: "Float", kind: "SCALAR", ofType: null };
  if (BOOL_TYPES.has(normalized)) return { name: "Boolean", kind: "SCALAR", ofType: null };
  if (STRING_TYPES.has(normalized)) return { name: "String", kind: "SCALAR", ofType: null };

  // Default unknown types to String
  return { name: "String", kind: "SCALAR", ofType: null };
}

function wrapNonNull(ref: IntrospectionTypeRef): IntrospectionTypeRef {
  return { name: null, kind: "NON_NULL", ofType: ref };
}

// ── Column parsing ──────────────────────────────────────

interface ParsedColumn {
  name: string;
  sqlType: string;
  notNull: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  references: { table: string; columns: string[] } | null;
}

function parseColumnLine(line: string): ParsedColumn | null {
  // Skip table-level constraints
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("--")) return null;

  const upperTrimmed = trimmed.toUpperCase();
  if (
    upperTrimmed.startsWith("PRIMARY KEY") ||
    upperTrimmed.startsWith("FOREIGN KEY") ||
    upperTrimmed.startsWith("UNIQUE(") ||
    upperTrimmed.startsWith("UNIQUE (") ||
    upperTrimmed.startsWith("CHECK") ||
    upperTrimmed.startsWith("CONSTRAINT")
  ) {
    return null;
  }

  // Match: column_name TYPE ...rest
  const match = trimmed.match(
    /^(\w+)\s+((?:DOUBLE\s+PRECISION|\w+)(?:\([^)]*\))?(?:\[\])?)\s*(.*)/i
  );
  if (!match) return null;

  const [, name, sqlType, rest] = match;
  const upperRest = rest.toUpperCase();

  const notNull = upperRest.includes("NOT NULL");
  const isPrimaryKey = upperRest.includes("PRIMARY KEY");
  const isUnique = /\bUNIQUE\b/.test(upperRest);

  // Inline REFERENCES
  let references: { table: string; columns: string[] } | null = null;
  const refMatch = rest.match(/REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
  if (refMatch) {
    references = {
      table: refMatch[1],
      columns: refMatch[2].split(",").map((c) => c.trim()),
    };
  }

  return { name, sqlType, notNull, isPrimaryKey, isUnique, references };
}

// ── CREATE TABLE parsing ────────────────────────────────

interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
  constraints: PgConstraint[];
}

function parseCreateTable(sql: string): ParsedTable[] {
  const tables: ParsedTable[] = [];

  // Match CREATE TABLE [IF NOT EXISTS] name (body)
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\);/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(sql)) !== null) {
    const tableName = tableMatch[1];
    const body = tableMatch[2];

    const columns: ParsedColumn[] = [];
    const constraints: PgConstraint[] = [];

    // Split body into lines, handling nested parentheses
    const lines = splitTableBody(body);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("--")) continue;

      const upperTrimmed = trimmed.toUpperCase();

      // Table-level PRIMARY KEY
      if (upperTrimmed.startsWith("PRIMARY KEY")) {
        const colsMatch = trimmed.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
        if (colsMatch) {
          constraints.push({
            name: null,
            type: "PRIMARY KEY",
            columns: colsMatch[1].split(",").map((c) => c.trim()),
          });
        }
        continue;
      }

      // Table-level FOREIGN KEY
      if (upperTrimmed.startsWith("FOREIGN KEY")) {
        const fkMatch = trimmed.match(
          /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/i
        );
        if (fkMatch) {
          constraints.push({
            name: null,
            type: "FOREIGN KEY",
            columns: fkMatch[1].split(",").map((c) => c.trim()),
            references: {
              table: fkMatch[2],
              columns: fkMatch[3].split(",").map((c) => c.trim()),
            },
          });
        }
        continue;
      }

      // Table-level UNIQUE
      if (upperTrimmed.startsWith("UNIQUE")) {
        const colsMatch = trimmed.match(/UNIQUE\s*\(([^)]+)\)/i);
        if (colsMatch) {
          constraints.push({
            name: null,
            type: "UNIQUE",
            columns: colsMatch[1].split(",").map((c) => c.trim()),
          });
        }
        continue;
      }

      // Table-level CHECK
      if (upperTrimmed.startsWith("CHECK")) {
        const exprMatch = trimmed.match(/CHECK\s*\((.+)\)\s*$/i);
        if (exprMatch) {
          // Extract the expression inside the outermost parentheses
          const fullExpr = extractCheckExpression(trimmed);
          constraints.push({
            name: null,
            type: "CHECK",
            columns: [],
            expression: fullExpr,
          });
        }
        continue;
      }

      // CONSTRAINT keyword
      if (upperTrimmed.startsWith("CONSTRAINT")) {
        continue;
      }

      // Regular column
      const col = parseColumnLine(trimmed);
      if (col) {
        columns.push(col);

        // Generate constraints from inline column modifiers
        if (col.notNull) {
          constraints.push({
            name: null,
            type: "NOT NULL",
            columns: [col.name],
          });
        }
        if (col.isPrimaryKey) {
          constraints.push({
            name: null,
            type: "PRIMARY KEY",
            columns: [col.name],
          });
        }
        if (col.isUnique) {
          constraints.push({
            name: null,
            type: "UNIQUE",
            columns: [col.name],
          });
        }
        if (col.references) {
          constraints.push({
            name: null,
            type: "FOREIGN KEY",
            columns: [col.name],
            references: col.references,
          });
        }
      }
    }

    tables.push({ name: tableName, columns, constraints });
  }

  return tables;
}

/** Split table body by commas, respecting nested parentheses. */
function splitTableBody(body: string): string[] {
  const lines: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of body) {
    if (char === "(") {
      depth++;
      current += char;
    } else if (char === ")") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      lines.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) lines.push(current);

  return lines;
}

/** Extract the CHECK expression from a CHECK constraint line. */
function extractCheckExpression(line: string): string {
  const checkIdx = line.toUpperCase().indexOf("CHECK");
  if (checkIdx === -1) return "";

  const afterCheck = line.slice(checkIdx + 5).trim();
  // Remove outer parentheses
  if (afterCheck.startsWith("(")) {
    // Find matching closing paren
    let depth = 0;
    let end = 0;
    for (let i = 0; i < afterCheck.length; i++) {
      if (afterCheck[i] === "(") depth++;
      if (afterCheck[i] === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    return afterCheck.slice(1, end).trim();
  }
  return afterCheck;
}

// ── CREATE INDEX parsing ────────────────────────────────

function parseCreateIndexes(sql: string): Map<string, PgIndex[]> {
  const indexMap = new Map<string, PgIndex[]>();

  // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table [USING method](columns)
  const indexRegex =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*(?:USING\s+(\w+)\s*)?\(([^)]+)\)/gi;

  let match;
  while ((match = indexRegex.exec(sql)) !== null) {
    const isUnique = !!match[1];
    const indexName = match[2];
    const tableName = match[3];
    const method = match[4] || undefined;
    const columns = match[5].split(",").map((c) => c.trim());

    const existing = indexMap.get(tableName) || [];
    existing.push({
      name: indexName,
      columns,
      unique: isUnique,
      type: method,
    });
    indexMap.set(tableName, existing);
  }

  return indexMap;
}

// ── ALTER TABLE ... ENABLE ROW LEVEL SECURITY ───────────

function parseRlsEnabled(sql: string): Set<string> {
  const rlsTables = new Set<string>();
  const rlsRegex = /ALTER\s+TABLE\s+(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  let match;
  while ((match = rlsRegex.exec(sql)) !== null) {
    rlsTables.add(match[1]);
  }
  return rlsTables;
}

// ── CREATE POLICY parsing ───────────────────────────────

function parseCreatePolicies(sql: string): Map<string, PgRlsPolicy[]> {
  const policyMap = new Map<string, PgRlsPolicy[]>();

  // CREATE POLICY "name" ON table [FOR command] [USING (expr)] [WITH CHECK (expr)]
  const policyRegex =
    /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(\w+)\s*([\s\S]*?)(?=;|CREATE\s+POLICY|ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+INDEX|$)/gi;

  let match;
  while ((match = policyRegex.exec(sql)) !== null) {
    const policyName = match[1];
    const tableName = match[2];
    const rest = match[3].trim();

    // Parse FOR command
    const forMatch = rest.match(/FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)/i);
    const command = forMatch ? forMatch[1].toUpperCase() : "ALL";

    // Parse USING expression
    const usingExpr = extractPolicyExpression(rest, "USING");

    // Parse WITH CHECK expression
    const withCheckExpr = extractPolicyExpression(rest, "WITH\\s+CHECK");

    const existing = policyMap.get(tableName) || [];
    existing.push({
      name: policyName,
      command,
      using: usingExpr || undefined,
      withCheck: withCheckExpr || undefined,
    });
    policyMap.set(tableName, existing);
  }

  return policyMap;
}

function extractPolicyExpression(text: string, keyword: string): string | null {
  const regex = new RegExp(keyword + "\\s*\\(", "i");
  const match = regex.exec(text);
  if (!match) return null;

  const startIdx = match.index + match[0].length;
  let depth = 1;
  let i = startIdx;

  while (i < text.length && depth > 0) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    i++;
  }

  return text.slice(startIdx, i - 1).trim();
}

// ── Main parser ─────────────────────────────────────────

export function parseSqlSchema(sql: string): SqlParseResult {
  const tables = parseCreateTable(sql);
  const indexMap = parseCreateIndexes(sql);
  const rlsTables = parseRlsEnabled(sql);
  const policyMap = parseCreatePolicies(sql);

  const metadata = new Map<string, PgTableMetadata>();
  const types: IntrospectionType[] = [];

  for (const table of tables) {
    // Collect table-level FK constraints (not already represented by inline FK columns)
    const tableFks = table.constraints.filter(
      (c) => c.type === "FOREIGN KEY" &&
        !table.columns.some((col) => col.references && col.name === c.columns[0] && c.columns.length === 1)
    );

    // Build IntrospectionType fields from columns
    const fields: Array<{ name: string; type: IntrospectionTypeRef }> = [];

    for (const col of table.columns) {
      let typeRef: IntrospectionTypeRef;

      if (col.references) {
        // FK column → reference the target table as OBJECT for edge creation
        typeRef = { name: col.references.table, kind: "OBJECT", ofType: null };
      } else {
        typeRef = mapSqlType(col.sqlType);
      }

      if (col.notNull) {
        typeRef = wrapNonNull(typeRef);
      }

      fields.push({ name: col.name, type: typeRef });
    }

    // Add synthetic edge fields for table-level FKs
    // (only if not already represented by an inline FK column)
    for (const fk of tableFks) {
      const targetTable = fk.references?.table;
      if (targetTable) {
        const alreadyHasField = fields.some((f) => {
          const leafName = resolveLeafTypeName(f.type);
          return leafName === targetTable;
        });
        if (!alreadyHasField) {
          fields.push({
            name: `_fk_${targetTable}`,
            type: { name: targetTable, kind: "OBJECT", ofType: null },
          });
        }
      }
    }

    types.push({
      name: table.name,
      kind: "OBJECT",
      description: null,
      fields,
    });

    // Build metadata
    const tableIndexes = indexMap.get(table.name) || [];
    const tablePolicies = policyMap.get(table.name) || [];
    const rlsEnabled = rlsTables.has(table.name);

    metadata.set(table.name, {
      constraints: table.constraints,
      indexes: tableIndexes,
      rlsPolicies: tablePolicies,
      rlsEnabled,
    });
  }

  return { types, metadata };
}

function resolveLeafTypeName(ref: IntrospectionTypeRef | null): string | null {
  if (!ref) return null;
  if (ref.kind === "NON_NULL" || ref.kind === "LIST") return resolveLeafTypeName(ref.ofType);
  return ref.name;
}
