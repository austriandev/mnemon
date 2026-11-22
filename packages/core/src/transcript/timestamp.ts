/** Seconds from the start of a meeting as `HH:MM:SS`, the transcript's own format. */
export function formatTimestamp(totalSeconds: number): string {
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}
