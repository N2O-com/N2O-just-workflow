// Toggl Track API client with rate limiting and in-memory caching.
// Ported from TogglDashboard src/App.jsx (lines 9-70).
// Token comes from process.env.TOGGL_API_TOKEN.

const TOGGL_API_BASE = "https://api.track.toggl.com/api/v9";
const TOGGL_REPORTS_BASE = "https://api.track.toggl.com/reports/api/v3";

function headers(token: string): Record<string, string> {
  return {
    Authorization: "Basic " + Buffer.from(token + ":api_token").toString("base64"),
    "Content-Type": "application/json",
  };
}

export class RateLimitError extends Error {
  resetSeconds: number;
  constructor(message: string, resetSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.resetSeconds = resetSeconds;
  }
}

// Sliding window counter — 30 requests/hour per Toggl free plan.
export const apiTracker = {
  calls: [] as number[],
  recordCall(): void {
    const now = Date.now();
    this.calls.push(now);
    this.calls = this.calls.filter((t) => now - t < 3_600_000);
  },
  getCount(): number {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < 3_600_000);
    return this.calls.length;
  },
};

// In-memory TTL cache with stale-while-revalidate pattern.
interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const responseCache: Record<string, CacheEntry> = {};

export function cacheGet(key: string, maxAgeMs: number): unknown | null {
  const entry = responseCache[key];
  if (entry && Date.now() - entry.timestamp < maxAgeMs) return entry.data;
  return null;
}

export function cacheSet(key: string, data: unknown): void {
  responseCache[key] = { data, timestamp: Date.now() };
}

export async function fetchToggl(
  url: string,
  token: string,
  options: RequestInit = {}
): Promise<any> {
  apiTracker.recordCall();
  const res = await fetch(url, { headers: headers(token), ...options });
  if (res.status === 402 || res.status === 429) {
    const text = await res.text().catch(() => "");
    const resetMatch = text.match(/reset in (\d+) seconds/);
    const resetSeconds = resetMatch ? parseInt(resetMatch[1]) : 60;
    throw new RateLimitError(
      `Rate limited. Quota resets in ${resetSeconds}s.`,
      resetSeconds
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status}: ${res.statusText}${text ? " — " + text.slice(0, 200) : ""}`
    );
  }
  return res.json();
}

export function getToken(): string {
  const token = process.env.TOGGL_API_TOKEN;
  if (!token) throw new Error("TOGGL_API_TOKEN environment variable is not set");
  return token;
}

export { TOGGL_API_BASE, TOGGL_REPORTS_BASE };
