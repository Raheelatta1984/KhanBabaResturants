export const RESTAURANT_TZ = "Australia/Sydney";

export type TimeParts = {
  iso: string; // YYYY-MM-DD in restaurant timezone
  weekday: number; // 0 = Sunday ... 6 = Saturday
  hour: number;
  minute: number;
  hhmm: string; // HH:MM (24h)
};

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: RESTAURANT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: RESTAURANT_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const weekdayFmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: RESTAURANT_TZ,
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Break a moment into restaurant-local parts (Sydney by default). */
export function getTimeParts(date = new Date()): TimeParts {
  const iso = dateFmt.format(date); // en-CA yields YYYY-MM-DD
  const hhmm = timeFmt.format(date);
  const [hour, minute] = hhmm.split(":").map(Number);
  const weekday = WEEKDAY_INDEX[weekdayFmt.format(date)] ?? 0;
  return { iso, weekday, hour, minute, hhmm };
}

export function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isTimeWithin(hhmm: string, start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true;
  const now = minutesFromHHMM(hhmm);
  const s = minutesFromHHMM(start);
  const e = minutesFromHHMM(end);
  if (s <= e) return now >= s && now < e;
  // Window crosses midnight
  return now >= s || now < e;
}

export function isWeekend(date = new Date()): boolean {
  const { weekday } = getTimeParts(date);
  return weekday === 0 || weekday === 6;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: RESTAURANT_TZ,
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: RESTAURANT_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatDate(value: string): string {
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function minutesSince(value: string | null | undefined): number {
  if (!value) return 0;
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}
