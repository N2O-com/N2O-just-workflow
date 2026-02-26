// HTTP-based SQL executor using the Supabase Management API.
// Avoids IPv6/pooler connectivity issues by going through HTTPS (IPv4).

const SUPABASE_REF = process.env.SUPABASE_REF ?? "mktnhfbpvksnyfzipuph";
const SUPABASE_ACCESS_TOKEN =
  process.env.SUPABASE_ACCESS_TOKEN ??
  "sbp_0432018dd9867db471847a730df45a97cc76f586";

const QUERY_URL = `https://api.supabase.com/v1/projects/${SUPABASE_REF}/database/query`;

function escapeParam(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  // Escape single quotes by doubling them
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

function interpolate(sql: string, params: any[]): string {
  let i = 0;
  return sql.replace(/\$(\d+)/g, (_, idx) => escapeParam(params[parseInt(idx) - 1]));
}

export class SupabasePool {
  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    const finalSql = params.length > 0 ? interpolate(sql, params) : sql;
    const res = await fetch(QUERY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: finalSql }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase query failed (${res.status}): ${body}`);
    }
    const rows = await res.json();
    return { rows: Array.isArray(rows) ? rows : [] };
  }

  async end(): Promise<void> {
    // No-op: HTTP connections are stateless
  }
}

let pool: SupabasePool | null = null;

export function getPool(): SupabasePool {
  if (!pool) {
    pool = new SupabasePool();
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
