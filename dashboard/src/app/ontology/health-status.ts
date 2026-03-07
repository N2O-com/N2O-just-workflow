/**
 * Health status utilities for the Ontology explorer.
 *
 * Computes per-entity staleness indicators based on DataHealth stream
 * timestamps relative to the last session end time.
 */

// ── Types ────────────────────────────────────────────────

export interface HealthStream {
  stream: string;
  count: number;
  lastUpdated: string | null;
  recentCount: number;
}

// ── Constants ────────────────────────────────────────────

/** Staleness tolerance per stream (in hours). Mirrors the health page thresholds. */
export const TOLERANCE: Record<string, number> = {
  transcripts: 1,
  workflow_events: 1,
  tasks: 24,
  developer_context: 168, // 7 days
  skill_versions: 720,    // 30 days
};

/** Maps DataHealth stream names to GraphQL entity type names. */
export const STREAM_ENTITY_MAP: Record<string, string> = {
  transcripts: "Transcript",
  workflow_events: "Event",
  tasks: "Task",
  developer_context: "DeveloperContext",
  skill_versions: "SkillVersion",
};

// ── Health status mapping ───────────────────────────────

/**
 * Compute health status per entity type from DataHealth streams.
 * Returns a map of entity type name -> "green" | "yellow" | "red".
 */
export function getHealthStatus(
  streams: HealthStream[],
  lastSessionEndedAt: string | null,
  streamEntityMap: Record<string, string>
): Record<string, "green" | "yellow" | "red"> {
  const result: Record<string, "green" | "yellow" | "red"> = {};

  if (!lastSessionEndedAt) return result;

  const sessionMs = new Date(lastSessionEndedAt).getTime();
  if (isNaN(sessionMs)) return result;

  for (const s of streams) {
    const entityName = streamEntityMap[s.stream];
    if (!entityName) continue;

    if (!s.lastUpdated) {
      result[entityName] = "red";
      continue;
    }

    const updatedMs = new Date(s.lastUpdated).getTime();
    if (isNaN(updatedMs)) {
      result[entityName] = "red";
      continue;
    }

    const tolerance = TOLERANCE[s.stream] ?? 24;
    const lagHours = Math.max(0, (sessionMs - updatedMs) / (1000 * 60 * 60));

    if (lagHours <= tolerance) {
      result[entityName] = "green";
    } else if (lagHours <= tolerance * 2) {
      result[entityName] = "yellow";
    } else {
      result[entityName] = "red";
    }
  }

  return result;
}
