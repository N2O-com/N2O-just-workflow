/**
 * Schema adapter interface for the Ontology explorer.
 *
 * Each adapter (GraphQL, PostgreSQL, etc.) implements this interface so the
 * explorer UI can consume any schema source without caring about the underlying
 * data format.
 */

import type { DocumentNode } from "@apollo/client/core";
import type { GraphData } from "./schema-parser";

// ── Types ────────────────────────────────────────────────

type IconComponent = React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;

export interface CategoryConfigEntry {
  label: string;
  color: string;
  icon: IconComponent;
}

export interface EntityColumnsConfig {
  query: DocumentNode;
  field: string;
  columns: string[];
}

// ── Adapter interface ───────────────────────────────────

export interface SchemaAdapter {
  /** Human-readable name for this adapter (e.g., "GraphQL", "PostgreSQL"). */
  name: string;

  /** Category configuration for the sidebar. Keys are category IDs. */
  getCategoryConfig(): Record<string, CategoryConfigEntry>;

  /** Assign a category ID to a given type name. */
  getCategoryForType(typeName: string): string;

  /** Get sample data query config for a type (optional — not all adapters have this). */
  getEntityColumns(typeName: string): EntityColumnsConfig | undefined;
}

export type { GraphData, IconComponent };
