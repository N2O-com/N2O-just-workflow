// Shared utility functions ported from TogglDashboard src/App.jsx

export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = Math.floor(Date.now() / 1000) + seconds;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

export function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatDateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function getWeekDates(weeksBack = 0): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  const dow = start.getDay();
  start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1) - weeksBack * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  if (end > now) end.setTime(now.getTime());
  return { start, end };
}

export function getWeeksInRange(
  startDate: Date,
  endDate: Date
): { key: string; label: string; start: Date; end: Date }[] {
  const weeks: { key: string; label: string; start: Date; end: Date }[] = [];
  const current = new Date(startDate);
  const dow = current.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  current.setDate(current.getDate() - offset);
  current.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
    weeks.push({
      key: formatDateKey(weekStart),
      label,
      start: weekStart,
      end: weekEnd > endDate ? new Date(endDate) : weekEnd,
    });
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

export function getWeekNumber(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d.getTime() - start.getTime() + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60000;
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

// Color palette for member avatars
const MEMBER_COLORS = [
  "#5c6bc0", "#26a69a", "#ef5350", "#ffa726", "#66bb6a",
  "#42a5f5", "#ab47bc", "#ec407a", "#8d6e63", "#78909c",
  "#7e57c2", "#29b6f6", "#d4e157", "#ff7043", "#26c6da",
];

export function getMemberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}

// Weekly targets by role
export const ROLE_TARGETS: Record<string, number> = {
  leadership: 25,
  developer: 35,
  "non-developer": 30,
};
