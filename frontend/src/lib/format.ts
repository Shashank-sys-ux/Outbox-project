const dayTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function formatListTime(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  const withinWeek = Math.abs(date.getTime() - Date.now()) < 6 * 24 * 60 * 60 * 1000;
  return withinWeek ? dayTime.format(date) : shortDate.format(date);
}

export function formatFullDate(iso: string | null): string {
  return iso ? fullDate.format(new Date(iso)) : "";
}

export function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60_000) {
    return rtf.format(Math.round(diffMs / 1000), "second");
  }
  if (abs < 3_600_000) {
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  }
  if (abs < 86_400_000) {
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  }
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

export function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)} seconds`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)} minutes`;
  }
  return `${Math.round(ms / 3_600_000)} hour${ms >= 7_200_000 ? "s" : ""}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}
