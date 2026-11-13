const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

/** Format an integer cents value as AUD, e.g. 1599 -> "$15.99" */
export function money(cents: number | null | undefined): string {
  return aud.format((cents ?? 0) / 100);
}

/** Parse a dollar input ("15.99") into integer cents. */
export function toCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function pct(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

export function roundToCents(cents: number, step: number): number {
  if (!step) return Math.round(cents);
  return Math.ceil(cents / step) * step;
}
