import { describe, it, expect } from "vitest";
import { parseSqlSchema } from "../sql-parser";
import { parseSchemaToGraph, type IntrospectionType } from "../schema-parser";
import type { PgTableMetadata } from "../pg-types";

// ── Helpers ──────────────────────────────────────────────

/** Find a type by name in the result. */
function findType(types: IntrospectionType[], name: string) {
  return types.find((t) => t.name === name);
}

/** Find a field by name on a type. */
function findField(type: IntrospectionType, fieldName: string) {
  return type.fields?.find((f) => f.name === fieldName);
}

/** Resolve a type ref to its leaf name (unwraps NON_NULL/LIST). */
function resolveTypeName(ref: { name: string | null; kind: string; ofType: typeof ref | null } | null): string | null {
  if (!ref) return null;
  if (ref.kind === "NON_NULL" || ref.kind === "LIST") return resolveTypeName(ref.ofType);
  return ref.name;
}

// ── Simple CREATE TABLE ─────────────────────────────────

describe("parseSqlSchema", () => {
  describe("basic table parsing", () => {
    it("parses a simple CREATE TABLE with columns and types", () => {
      const sql = `
        CREATE TABLE users (
          id INTEGER,
          name TEXT,
          email VARCHAR(255)
        );
      `;
      const { types, metadata } = parseSqlSchema(sql);

      const usersType = findType(types, "users")!;
      expect(usersType.kind).toBe("OBJECT");
      expect(usersType.fields).toHaveLength(3);

      const idField = findField(usersType, "id")!;
      expect(resolveTypeName(idField.type)).toBe("Int");

      const nameField = findField(usersType, "name")!;
      expect(resolveTypeName(nameField.type)).toBe("String");

      const emailField = findField(usersType, "email")!;
      expect(resolveTypeName(emailField.type)).toBe("String");
    });

    it("parses multiple CREATE TABLE statements", () => {
      const sql = `
        CREATE TABLE sprints (
          id INTEGER,
          name TEXT
        );
        CREATE TABLE tasks (
          id INTEGER,
          title TEXT,
          sprint_id INTEGER
        );
        CREATE TABLE developers (
          id INTEGER,
          full_name TEXT
        );
      `;
      const { types } = parseSqlSchema(sql);
      expect(types).toHaveLength(3);
      expect(types.map((t) => t.name).sort()).toEqual(["developers", "sprints", "tasks"]);
    });

    it("handles CREATE TABLE IF NOT EXISTS", () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER,
          title TEXT
        );
      `;
      const { types } = parseSqlSchema(sql);
      expect(findType(types, "tasks")).toBeDefined();
      expect(findType(types, "tasks")!.fields).toHaveLength(2);
    });

    it("returns empty results for empty string", () => {
      const { types, metadata } = parseSqlSchema("");
      expect(types).toHaveLength(0);
      expect(metadata.size).toBe(0);
    });

    it("returns empty arrays for SQL with no CREATE TABLE", () => {
      const sql = `
        CREATE VIEW active_tasks AS SELECT * FROM tasks;
        INSERT INTO tasks VALUES (1, 'hello');
      `;
      const { types, metadata } = parseSqlSchema(sql);
      expect(types).toHaveLength(0);
      expect(metadata.size).toBe(0);
    });
  });

  // ── Column type mapping ─────────────────────────────────

  describe("column type mapping", () => {
    it("maps INTEGER/INT/BIGINT/SMALLINT/SERIAL/BIGSERIAL to Int", () => {
      const sql = `
        CREATE TABLE nums (
          a INTEGER,
          b INT,
          c BIGINT,
          d SMALLINT,
          e SERIAL,
          f BIGSERIAL
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "nums")!;
      for (const field of t.fields!) {
        expect(resolveTypeName(field.type)).toBe("Int");
      }
    });

    it("maps TEXT/VARCHAR/CHAR to String", () => {
      const sql = `
        CREATE TABLE strings (
          a TEXT,
          b VARCHAR(255),
          c CHAR(10)
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "strings")!;
      for (const field of t.fields!) {
        expect(resolveTypeName(field.type)).toBe("String");
      }
    });

    it("maps REAL/FLOAT/DOUBLE/NUMERIC/DECIMAL to Float", () => {
      const sql = `
        CREATE TABLE floats (
          a REAL,
          b FLOAT,
          c DOUBLE PRECISION,
          d NUMERIC,
          e DECIMAL(10,2)
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "floats")!;
      for (const field of t.fields!) {
        expect(resolveTypeName(field.type)).toBe("Float");
      }
    });

    it("maps BOOLEAN/BOOL to Boolean", () => {
      const sql = `
        CREATE TABLE bools (
          a BOOLEAN,
          b BOOL
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "bools")!;
      for (const field of t.fields!) {
        expect(resolveTypeName(field.type)).toBe("Boolean");
      }
    });

    it("maps TIMESTAMP/TIMESTAMPTZ/DATE/DATETIME to String", () => {
      const sql = `
        CREATE TABLE dates (
          a TIMESTAMP,
          b TIMESTAMPTZ,
          c DATE,
          d DATETIME
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "dates")!;
      for (const field of t.fields!) {
        expect(resolveTypeName(field.type)).toBe("String");
      }
    });

    it("maps JSONB/JSON to String", () => {
      const sql = `
        CREATE TABLE json_data (
          a JSONB,
          b JSON
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "json_data")!;
      for (const field of t.fields!) {
        expect(resolveTypeName(field.type)).toBe("String");
      }
    });
  });

  // ── NOT NULL handling ───────────────────────────────────

  describe("NOT NULL handling", () => {
    it("wraps NOT NULL columns in NON_NULL type ref", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "tasks")!;

      const idField = findField(t, "id")!;
      expect(idField.type.kind).toBe("NON_NULL");
      expect(idField.type.ofType?.name).toBe("Int");

      const titleField = findField(t, "title")!;
      expect(titleField.type.kind).toBe("NON_NULL");

      const descField = findField(t, "description")!;
      expect(descField.type.kind).not.toBe("NON_NULL");
      expect(descField.type.name).toBe("String");
    });

    it("records NOT NULL as a constraint in metadata", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      const notNullConstraints = meta.constraints.filter((c) => c.type === "NOT NULL");
      expect(notNullConstraints).toHaveLength(2);
      expect(notNullConstraints.map((c) => c.columns[0]).sort()).toEqual(["id", "title"]);
    });
  });

  // ── DEFAULT handling ────────────────────────────────────

  describe("DEFAULT handling", () => {
    it("parses columns with DEFAULT values (does not affect type)", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER NOT NULL,
          status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT 0
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "tasks")!;
      expect(t.fields).toHaveLength(4);

      // DEFAULT doesn't change the type mapping
      expect(resolveTypeName(findField(t, "status")!.type)).toBe("String");
      expect(resolveTypeName(findField(t, "created_at")!.type)).toBe("String");
      expect(resolveTypeName(findField(t, "is_active")!.type)).toBe("Boolean");
    });
  });

  // ── Inline PRIMARY KEY ──────────────────────────────────

  describe("inline PRIMARY KEY", () => {
    it("records inline PRIMARY KEY constraint", () => {
      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("users")!;
      const pk = meta.constraints.find((c) => c.type === "PRIMARY KEY");
      expect(pk).toBeDefined();
      expect(pk!.columns).toEqual(["id"]);
    });
  });

  // ── Table-level composite PRIMARY KEY ───────────────────

  describe("table-level PRIMARY KEY", () => {
    it("records composite PRIMARY KEY from table constraint", () => {
      const sql = `
        CREATE TABLE task_dependencies (
          sprint TEXT NOT NULL,
          task_num INTEGER NOT NULL,
          depends_on_sprint TEXT NOT NULL,
          depends_on_task INTEGER NOT NULL,
          PRIMARY KEY (sprint, task_num, depends_on_sprint, depends_on_task)
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("task_dependencies")!;
      const pk = meta.constraints.find((c) => c.type === "PRIMARY KEY");
      expect(pk).toBeDefined();
      expect(pk!.columns).toEqual(["sprint", "task_num", "depends_on_sprint", "depends_on_task"]);
    });
  });

  // ── Inline UNIQUE ───────────────────────────────────────

  describe("inline UNIQUE", () => {
    it("records inline UNIQUE constraint", () => {
      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT UNIQUE
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("users")!;
      const unique = meta.constraints.find((c) => c.type === "UNIQUE");
      expect(unique).toBeDefined();
      expect(unique!.columns).toEqual(["email"]);
    });
  });

  // ── Table-level UNIQUE ──────────────────────────────────

  describe("table-level UNIQUE", () => {
    it("records table-level UNIQUE constraint with multiple columns", () => {
      const sql = `
        CREATE TABLE skill_versions (
          id INTEGER PRIMARY KEY,
          skill_name TEXT NOT NULL,
          version TEXT NOT NULL,
          UNIQUE(skill_name, version)
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("skill_versions")!;
      const unique = meta.constraints.find((c) => c.type === "UNIQUE");
      expect(unique).toBeDefined();
      expect(unique!.columns).toEqual(["skill_name", "version"]);
    });
  });

  // ── Inline REFERENCES (FK) ─────────────────────────────

  describe("inline REFERENCES", () => {
    it("records inline REFERENCES as FK constraint", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          sprint_id INTEGER REFERENCES sprints(id),
          title TEXT
        );
        CREATE TABLE sprints (
          id INTEGER PRIMARY KEY,
          name TEXT
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      const fk = meta.constraints.find((c) => c.type === "FOREIGN KEY");
      expect(fk).toBeDefined();
      expect(fk!.columns).toEqual(["sprint_id"]);
      expect(fk!.references).toEqual({ table: "sprints", columns: ["id"] });
    });

    it("creates an edge-producing field for FK columns", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          sprint_id INTEGER REFERENCES sprints(id),
          title TEXT
        );
        CREATE TABLE sprints (
          id INTEGER PRIMARY KEY,
          name TEXT
        );
      `;
      const { types } = parseSqlSchema(sql);
      const tasksType = findType(types, "tasks")!;
      const sprintField = findField(tasksType, "sprint_id")!;

      // FK column type should reference the target table as OBJECT
      expect(resolveTypeName(sprintField.type)).toBe("sprints");
    });
  });

  // ── Table-level FOREIGN KEY ─────────────────────────────

  describe("table-level FOREIGN KEY", () => {
    it("records table-level FOREIGN KEY constraint", () => {
      const sql = `
        CREATE TABLE task_dependencies (
          sprint TEXT NOT NULL,
          task_num INTEGER NOT NULL,
          depends_on_sprint TEXT NOT NULL,
          depends_on_task INTEGER NOT NULL,
          PRIMARY KEY (sprint, task_num, depends_on_sprint, depends_on_task),
          FOREIGN KEY (sprint, task_num) REFERENCES tasks(sprint, task_num),
          FOREIGN KEY (depends_on_sprint, depends_on_task) REFERENCES tasks(sprint, task_num)
        );
        CREATE TABLE tasks (
          sprint TEXT NOT NULL,
          task_num INTEGER NOT NULL,
          title TEXT
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("task_dependencies")!;
      const fks = meta.constraints.filter((c) => c.type === "FOREIGN KEY");
      expect(fks).toHaveLength(2);

      expect(fks[0].columns).toEqual(["sprint", "task_num"]);
      expect(fks[0].references).toEqual({ table: "tasks", columns: ["sprint", "task_num"] });

      expect(fks[1].columns).toEqual(["depends_on_sprint", "depends_on_task"]);
      expect(fks[1].references).toEqual({ table: "tasks", columns: ["sprint", "task_num"] });
    });

    it("creates edge-producing fields for table-level FK", () => {
      const sql = `
        CREATE TABLE task_deps (
          sprint TEXT,
          task_num INTEGER,
          FOREIGN KEY (sprint, task_num) REFERENCES tasks(sprint, task_num)
        );
        CREATE TABLE tasks (
          sprint TEXT,
          task_num INTEGER,
          title TEXT
        );
      `;
      const { types } = parseSqlSchema(sql);
      const depsType = findType(types, "task_deps")!;

      // Should have a synthetic field referencing 'tasks'
      const fkField = depsType.fields!.find(
        (f) => resolveTypeName(f.type) === "tasks"
      );
      expect(fkField).toBeDefined();
    });
  });

  // ── CHECK constraints ───────────────────────────────────

  describe("CHECK constraints", () => {
    it("records CHECK constraints with IN clauses", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          status TEXT DEFAULT 'pending',
          CHECK (status IN ('pending', 'red', 'green', 'blocked'))
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      const check = meta.constraints.find((c) => c.type === "CHECK");
      expect(check).toBeDefined();
      expect(check!.expression).toContain("status");
      expect(check!.expression).toContain("IN");
    });

    it("records multiple CHECK constraints", () => {
      const sql = `
        CREATE TABLE tasks (
          status TEXT,
          type TEXT,
          complexity TEXT,
          CHECK (status IN ('pending', 'red', 'green', 'blocked')),
          CHECK (type IS NULL OR type IN ('database', 'actions', 'frontend')),
          CHECK (complexity IS NULL OR complexity IN ('low', 'medium', 'high'))
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      const checks = meta.constraints.filter((c) => c.type === "CHECK");
      expect(checks).toHaveLength(3);
    });
  });

  // ── CREATE INDEX ────────────────────────────────────────

  describe("CREATE INDEX", () => {
    it("records a basic index", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          status TEXT
        );
        CREATE INDEX idx_tasks_status ON tasks(status);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      expect(meta.indexes).toHaveLength(1);
      expect(meta.indexes[0].name).toBe("idx_tasks_status");
      expect(meta.indexes[0].columns).toEqual(["status"]);
      expect(meta.indexes[0].unique).toBe(false);
    });

    it("records a UNIQUE index", () => {
      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT
        );
        CREATE UNIQUE INDEX idx_users_email ON users(email);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("users")!;
      expect(meta.indexes[0].unique).toBe(true);
    });

    it("records an index with USING clause", () => {
      const sql = `
        CREATE TABLE docs (
          id INTEGER PRIMARY KEY,
          content TEXT
        );
        CREATE INDEX idx_docs_content ON docs USING gin(content);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("docs")!;
      expect(meta.indexes[0].type).toBe("gin");
      expect(meta.indexes[0].columns).toEqual(["content"]);
    });

    it("handles CREATE INDEX IF NOT EXISTS", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          sprint TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      expect(meta.indexes).toHaveLength(1);
      expect(meta.indexes[0].name).toBe("idx_tasks_sprint");
    });

    it("records multi-column indexes", () => {
      const sql = `
        CREATE TABLE events (
          sprint TEXT,
          task_num INTEGER,
          event_type TEXT
        );
        CREATE INDEX idx_events_task ON events(sprint, task_num);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("events")!;
      expect(meta.indexes[0].columns).toEqual(["sprint", "task_num"]);
    });
  });

  // ── RLS (Row Level Security) ────────────────────────────

  describe("ALTER TABLE ENABLE ROW LEVEL SECURITY", () => {
    it("marks tables with RLS enabled", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          title TEXT
        );
        ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      expect(meta.rlsEnabled).toBe(true);
    });

    it("defaults rlsEnabled to false when no ALTER TABLE", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          title TEXT
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      expect(meta.rlsEnabled).toBe(false);
    });
  });

  // ── CREATE POLICY ───────────────────────────────────────

  describe("CREATE POLICY", () => {
    it("records a policy with USING clause", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          title TEXT
        );
        CREATE POLICY "Service role full access" ON tasks
          FOR ALL USING (true);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      expect(meta.rlsPolicies).toHaveLength(1);
      expect(meta.rlsPolicies[0].name).toBe("Service role full access");
      expect(meta.rlsPolicies[0].command).toBe("ALL");
      expect(meta.rlsPolicies[0].using).toBe("true");
    });

    it("records a policy with USING and WITH CHECK", () => {
      const sql = `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY
        );
        CREATE POLICY "Service role full access" ON tasks
          FOR ALL USING (true) WITH CHECK (true);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      expect(meta.rlsPolicies[0].using).toBe("true");
      expect(meta.rlsPolicies[0].withCheck).toBe("true");
    });

    it("records policy command type (SELECT, INSERT, UPDATE, DELETE)", () => {
      const sql = `
        CREATE TABLE data (
          id INTEGER PRIMARY KEY,
          owner_id TEXT
        );
        CREATE POLICY "Users read own" ON data
          FOR SELECT USING (owner_id = current_user);
        CREATE POLICY "Users insert own" ON data
          FOR INSERT WITH CHECK (owner_id = current_user);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("data")!;
      expect(meta.rlsPolicies).toHaveLength(2);
      expect(meta.rlsPolicies[0].command).toBe("SELECT");
      expect(meta.rlsPolicies[0].using).toBe("owner_id = current_user");
      expect(meta.rlsPolicies[1].command).toBe("INSERT");
      expect(meta.rlsPolicies[1].withCheck).toBe("owner_id = current_user");
    });

    it("handles policy without FOR clause (defaults to ALL)", () => {
      const sql = `
        CREATE TABLE items (id INTEGER PRIMARY KEY);
        CREATE POLICY "full_access" ON items USING (true);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("items")!;
      expect(meta.rlsPolicies[0].command).toBe("ALL");
    });
  });

  // ── Edge generation ─────────────────────────────────────

  describe("edge generation via parseSchemaToGraph compatibility", () => {
    it("produces IntrospectionTypes that feed into parseSchemaToGraph for edges", () => {
      const sql = `
        CREATE TABLE sprints (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          title TEXT,
          sprint_id INTEGER REFERENCES sprints(id)
        );
      `;
      const { types } = parseSqlSchema(sql);

      // Import and use parseSchemaToGraph
      // parseSchemaToGraph imported at top of file
      const { nodes, edges } = parseSchemaToGraph(types);

      expect(nodes).toHaveLength(2);
      // Task -> Sprint edge from FK
      const fkEdge = edges.find(
        (e: { source: string; target: string }) =>
          e.source === "tasks" && e.target === "sprints"
      );
      expect(fkEdge).toBeDefined();
    });

    it("tables with no FKs produce nodes but no edges", () => {
      const sql = `
        CREATE TABLE config (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `;
      const { types } = parseSqlSchema(sql);

      // parseSchemaToGraph imported at top of file
      const { nodes, edges } = parseSchemaToGraph(types);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("config");
      expect(edges).toHaveLength(0);
    });
  });

  // ── GraphNode pgMetadata extension ──────────────────────

  describe("GraphNode pgMetadata field", () => {
    it("GraphNode interface accepts optional pgMetadata", () => {
      // Verify the type extension exists by importing and constructing
      // parseSchemaToGraph imported at top of file
      const types: IntrospectionType[] = [
        {
          name: "Test",
          kind: "OBJECT",
          description: null,
          fields: [{ name: "id", type: { name: "Int", kind: "SCALAR", ofType: null } }],
        },
      ];
      const { nodes } = parseSchemaToGraph(types);
      // pgMetadata should be assignable (optional field)
      const node = nodes[0];
      const metadata: PgTableMetadata = {
        constraints: [],
        indexes: [],
        rlsPolicies: [],
        rlsEnabled: false,
      };
      node.pgMetadata = metadata;
      expect(node.pgMetadata).toBe(metadata);
    });
  });

  // ── Real fixture: .pm/schema.sql patterns ───────────────

  describe("real-world patterns from .pm/schema.sql", () => {
    it("parses table with CHECK, DEFAULT, composite PK, and FK", () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS tasks (
            sprint TEXT NOT NULL,
            task_num INTEGER NOT NULL,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            type TEXT,
            owner TEXT,
            estimated_minutes REAL,
            complexity TEXT,
            reversions INTEGER DEFAULT 0,
            priority REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (sprint, task_num),
            CHECK (status IN ('pending', 'red', 'green', 'blocked')),
            CHECK (type IS NULL OR type IN ('database', 'actions', 'frontend', 'infra', 'agent', 'e2e', 'docs')),
            CHECK (complexity IS NULL OR complexity IN ('low', 'medium', 'high', 'unknown'))
        );
      `;
      const { types, metadata } = parseSqlSchema(sql);

      // Table has exactly 12 columns
      const t = findType(types, "tasks")!;
      expect(t.fields).toHaveLength(12);

      // Metadata
      const meta = metadata.get("tasks")!;

      // Composite PK
      const pk = meta.constraints.find((c) => c.type === "PRIMARY KEY")!;
      expect(pk.columns).toEqual(["sprint", "task_num"]);

      // Exactly 3 CHECK constraints
      const checks = meta.constraints.filter((c) => c.type === "CHECK");
      expect(checks).toHaveLength(3);

      // Exactly 3 NOT NULL constraints (sprint, task_num, title)
      const notNulls = meta.constraints.filter((c) => c.type === "NOT NULL");
      expect(notNulls).toHaveLength(3);
    });

    it("parses table with FOREIGN KEY referencing composite key", () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS tasks (
            sprint TEXT NOT NULL,
            task_num INTEGER NOT NULL,
            title TEXT NOT NULL,
            PRIMARY KEY (sprint, task_num)
        );
        CREATE TABLE IF NOT EXISTS task_dependencies (
            sprint TEXT NOT NULL,
            task_num INTEGER NOT NULL,
            depends_on_sprint TEXT NOT NULL,
            depends_on_task INTEGER NOT NULL,
            PRIMARY KEY (sprint, task_num, depends_on_sprint, depends_on_task),
            FOREIGN KEY (sprint, task_num) REFERENCES tasks(sprint, task_num),
            FOREIGN KEY (depends_on_sprint, depends_on_task) REFERENCES tasks(sprint, task_num)
        );
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("task_dependencies")!;
      const fks = meta.constraints.filter((c) => c.type === "FOREIGN KEY");
      expect(fks).toHaveLength(2);
      expect(fks[0].references).toEqual({ table: "tasks", columns: ["sprint", "task_num"] });
      expect(fks[1].references).toEqual({ table: "tasks", columns: ["sprint", "task_num"] });
    });
  });

  // ── Real fixture: supabase-schema.sql patterns ──────────

  describe("real-world patterns from supabase-schema.sql", () => {
    it("parses PostgreSQL-specific types (TIMESTAMPTZ, JSONB, TEXT[], BIGSERIAL)", () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS activity_log (
          id BIGSERIAL PRIMARY KEY,
          event_type TEXT NOT NULL,
          agent_id TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "activity_log")!;
      expect(t).toBeDefined();

      expect(resolveTypeName(findField(t, "id")!.type)).toBe("Int");
      expect(resolveTypeName(findField(t, "event_type")!.type)).toBe("String");
      expect(resolveTypeName(findField(t, "metadata")!.type)).toBe("String");
      expect(resolveTypeName(findField(t, "created_at")!.type)).toBe("String");
    });

    it("parses TEXT[] array columns", () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS agents (
          agent_id TEXT PRIMARY KEY,
          files_touched TEXT[]
        );
      `;
      const { types } = parseSqlSchema(sql);
      const t = findType(types, "agents")!;
      const filesField = findField(t, "files_touched")!;

      // Array type should be LIST wrapping String
      expect(filesField.type.kind).toBe("LIST");
      expect(filesField.type.ofType?.name).toBe("String");
    });

    it("parses ALTER TABLE ENABLE ROW LEVEL SECURITY for multiple tables", () => {
      const sql = `
        CREATE TABLE tasks (id INTEGER PRIMARY KEY);
        CREATE TABLE agents (id TEXT PRIMARY KEY);
        CREATE TABLE activity_log (id INTEGER PRIMARY KEY);
        ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
        ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
        ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
      `;
      const { metadata } = parseSqlSchema(sql);
      expect(metadata.get("tasks")!.rlsEnabled).toBe(true);
      expect(metadata.get("agents")!.rlsEnabled).toBe(true);
      expect(metadata.get("activity_log")!.rlsEnabled).toBe(true);
    });

    it("parses CREATE POLICY with quoted names", () => {
      const sql = `
        CREATE TABLE tasks (id INTEGER PRIMARY KEY);
        CREATE POLICY "Service role full access" ON tasks
          FOR ALL USING (true) WITH CHECK (true);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("tasks")!;
      expect(meta.rlsPolicies[0].name).toBe("Service role full access");
    });
  });

  // ── Metadata completeness ───────────────────────────────

  describe("metadata completeness", () => {
    it("initializes metadata for every parsed table", () => {
      const sql = `
        CREATE TABLE a (id INTEGER);
        CREATE TABLE b (id INTEGER);
        CREATE TABLE c (id INTEGER);
      `;
      const { metadata } = parseSqlSchema(sql);
      expect(metadata.size).toBe(3);
      for (const [, meta] of metadata) {
        expect(meta.constraints).toBeDefined();
        expect(meta.indexes).toBeDefined();
        expect(meta.rlsPolicies).toBeDefined();
        expect(meta.rlsEnabled).toBe(false);
      }
    });

    it("aggregates all constraint types on a single table", () => {
      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL,
          CHECK (role IN ('admin', 'user', 'guest'))
        );
        CREATE INDEX idx_users_role ON users(role);
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "read_all" ON users FOR SELECT USING (true);
      `;
      const { metadata } = parseSqlSchema(sql);
      const meta = metadata.get("users")!;

      expect(meta.constraints.some((c) => c.type === "PRIMARY KEY")).toBe(true);
      expect(meta.constraints.some((c) => c.type === "NOT NULL")).toBe(true);
      expect(meta.constraints.some((c) => c.type === "UNIQUE")).toBe(true);
      expect(meta.constraints.some((c) => c.type === "CHECK")).toBe(true);
      expect(meta.indexes).toHaveLength(1);
      expect(meta.rlsEnabled).toBe(true);
      expect(meta.rlsPolicies).toHaveLength(1);
    });
  });
});
