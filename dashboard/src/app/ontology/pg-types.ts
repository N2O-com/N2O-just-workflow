/**
 * PostgreSQL-specific metadata types for the Ontology explorer.
 *
 * Attached to GraphNode.pgMetadata when the schema source is SQL.
 */

export interface PgConstraint {
  name: string | null;
  type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "NOT NULL";
  columns: string[];
  expression?: string;
  references?: { table: string; columns: string[] };
}

export interface PgIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;
}

export interface PgRlsPolicy {
  name: string;
  command: string;
  using?: string;
  withCheck?: string;
}

export interface PgTableMetadata {
  constraints: PgConstraint[];
  indexes: PgIndex[];
  rlsPolicies: PgRlsPolicy[];
  rlsEnabled: boolean;
}
