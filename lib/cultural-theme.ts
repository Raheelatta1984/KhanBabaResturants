/** Calendar dates are evaluated in the restaurant's local timezone. Fixed-date
 * occasions take precedence over the weekday rotation. */
export type ThemeId = "royal" | "lahore" | "heritage";
export const THEMES: Record<ThemeId, { label: string; image: string }> = {
  royal: { label: "Royal lounge", image: "/images/interior-1.jpg" },
  lahore: { label: "Lahore heritage", image: "/images/interior-2.jpg" },
  heritage: { label: "South Asian celebration", image: "/images/interior-3.jpg" },
};

export function automaticTheme(date: Date): { theme: ThemeId; occasion: string } {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const key = `${part("month")}-${part("day")}`;
  const occasions: Record<string, { theme: ThemeId; occasion: string }> = {
    "3-23": { theme: "lahore", occasion: "Pakistan Day" },
    "8-14": { theme: "lahore", occasion: "Pakistan Independence Day" },
    "8-15": { theme: "heritage", occasion: "India Independence Day" },
    "1-26": { theme: "heritage", occasion: "India Republic Day" },
  };
  if (occasions[key]) return occasions[key];
  const weekday = part("weekday");
  if (weekday === "Fri" || weekday === "Sat") return { theme: "royal", occasion: "Royal lounge weekend" };
  if (weekday === "Sun" || weekday === "Mon") return { theme: "heritage", occasion: "South Asian heritage" };
  return { theme: "lahore", occasion: "Lahore heritage" };
}
