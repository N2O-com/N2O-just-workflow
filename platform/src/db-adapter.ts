import type { SupabasePool } from "./db.js";

// Convert ? placeholders to $1, $2, ... for Postgres
function toPgSql(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function queryAll(
  pool: SupabasePool,
  sql: string,
  params: any[] = []
): Promise<any[]> {
  const { rows } = await pool.query(toPgSql(sql), params);
  return rows;
}

export async function queryOne(
  pool: SupabasePool,
  sql: string,
  params: any[] = []
): Promise<any | null> {
  const rows = await queryAll(pool, sql, params);
  return rows[0] ?? null;
}

export function whereClause(
  conditions: string[],
  params: any[]
): { where: string; params: any[] } {
  if (conditions.length === 0) return { where: "", params };
  return { where: `WHERE ${conditions.join(" AND ")}`, params };
}
