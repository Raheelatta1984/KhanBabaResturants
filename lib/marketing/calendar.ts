import type { Db } from "../db";
import { getSettings, settingValue } from "../settings";
import { menuHashtags, todayMenu, type MenuLine, type TodayMenu } from "./engine";

/**
 * A seven-day content calendar, generated from the live menu.
 *
 * The reason this exists: a calendar written once is stale within a week. The
 * dishes change, a Friday special runs out, the delivery area moves — and the
 * document nobody updates becomes a document nobody reads. So the calendar is a
 * *view* over the menu that the kitchen is actually selling today, not a
 * separate source of truth that drifts from it.
 *
 * Every day gets one post, and each day has a different job:
 *
 *   Mon  the week ahead        — what is cooking, sets expectation
 *   Tue  one dish, one story   — depth beats breadth on a quiet night
 *   Wed  social proof          — a review or a repeat customer
 *   Thu  the weekend warning   — "Friday fills up", scarcity that is true
 *   Fri  the big one           — the post most likely to convert
 *   Sat  family / sharing      — bigger trays, group orders
 *   Sun  slow Sunday           — comfort, chai, the end of the week
 *
 * Everything is deterministic for a given date and menu, so regenerating the
 * file does not churn the diff.
 */

export type CalendarChannel = "facebook" | "instagram" | "whatsapp" | "blog";

export type CalendarDay = {
  /** 1 = Monday … 7 = Sunday. */
  dayNumber: number;
  weekday: string;
  /** ISO date for the slot. */
  date: string;
  /** What this day is for, in one line. */
  theme: string;
  /** The idea behind the post, before it becomes copy. */
  angle: string;
  /** Ready-to-paste caption. */
  caption: string;
  /** Short hook for the first line, where the feed truncates. */
  hook: string;
  /** One clear call to action. */
  cta: string;
  hashtags: string[];
  channels: CalendarChannel[];
  /** Best time to post, in the restaurant's timezone. */
  bestTime: string;
  /** The dish this post is built around, when it has one. */
  featureDish: string | null;
  /** A vegetable side or drink to pair, so the post is not only meat. */
  pairing: string | null;
  /** What the owner should actually do, in one sentence. */
  action: string;
};

export type ContentCalendar = {
  generatedFor: string;
  restaurantName: string;
  deliveryArea: string;
  baseUrl: string;
  totalDishes: number;
  days: CalendarDay[];
  /** Things worth knowing before posting any of it. */
  notes: string[];
};

const THEMES: { weekday: string; theme: string; angle: string; bestTime: string; action: string }[] = [
  {
    weekday: "Monday",
    theme: "The week ahead",
    angle:
      "Monday is a planning day. Show the range rather than one hero dish — people decide *whether* to order this week, not yet what.",
    bestTime: "11:30",
    action: "Post the week's line-up with a clear menu link. Pin it to the top of the page.",
  },
  {
    weekday: "Tuesday",
    theme: "One dish, one story",
    angle:
      "Quietest night of the week, so go narrow and deep. One dish, how it is cooked, why it takes the time it takes.",
    bestTime: "17:00",
    action: "Pick the dish with the best photo. Write about the cooking, not the price.",
  },
  {
    weekday: "Wednesday",
    theme: "Someone else's words",
    angle:
      "Social proof midweek. A real review or a returning customer beats anything the restaurant says about itself.",
    bestTime: "12:00",
    action: "Screenshot a genuine review. Ask permission if the name is visible.",
  },
  {
    weekday: "Thursday",
    theme: "The weekend warning",
    angle:
      "Friday and Saturday fill up. Saying so on Thursday is scarcity that is actually true, which is the only kind worth using.",
    bestTime: "16:30",
    action: "Mention the wait honestly. Offer pre-ordering as the fix, not a discount.",
  },
  {
    weekday: "Friday",
    theme: "The main event",
    angle:
      "Highest-intent day of the week. Lead with the dish most people order, and make ordering one tap away.",
    bestTime: "11:00",
    action: "Post the hero dish and the delivery cut-off time. Reply to every comment.",
  },
  {
    weekday: "Saturday",
    theme: "Feed the table",
    angle:
      "Saturday is group ordering. Bigger trays, sharing platters, the maths of feeding six people without cooking.",
    bestTime: "12:30",
    action: "Frame it as feeding a table, not a person. Mention family-size options.",
  },
  {
    weekday: "Sunday",
    theme: "Slow Sunday",
    angle:
      "Comfort and chai. Lower pressure, warmer tone — the post people save rather than act on immediately.",
    bestTime: "10:30",
    action: "Warm, unhurried tone. No hard sell on a Sunday.",
  },
];

const CHANNELS_BY_DAY: CalendarChannel[][] = [
  ["facebook", "instagram", "whatsapp"],
  ["facebook", "instagram"],
  ["facebook", "instagram", "blog"],
  ["facebook", "instagram", "whatsapp"],
  ["facebook", "instagram", "whatsapp", "blog"],
  ["facebook", "instagram"],
  ["facebook", "instagram", "blog"],
];

/** Sydney "now", so the calendar never runs a day ahead of the kitchen. */
function sydneyNow(): Date {
  const now = new Date();
  // Sydney is UTC+10 or +11. Deriving the offset from Intl avoids hard-coding
  // daylight saving, which would silently shift the whole calendar twice a year.
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function money(cents: number, currency: string): string {
  const symbol = currency === "AUD" ? "$" : "";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/**
 * Pick a vegetable or drink to pair with a hero dish. Halal curry houses get
 * asked "is there anything without meat?" constantly; answering it inside a post
 * saves a message and sells the side.
 */
function pickPairing(menu: TodayMenu, hero: MenuLine | null): string | null {
  const all = menu.categories.flatMap((group) => group.items);
  // "Lamb Dum Biryani, try it with Biryani Rice" is not a pairing, it is the
  // same dish twice. A side has to add something the hero does not already have.
  const sameDish = (name: string) => {
    if (!hero) return false;
    const words = hero.name.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    const other = name.toLowerCase();
    return words.some((word) => other.includes(word));
  };
  const side = all.find(
    (item) => item.is_veg && item.item_id !== hero?.item_id && !sameDish(item.name),
  );
  if (side) return side.name;
  const drink = all.find((item) => /lassi|chai|drink|juice|soda/i.test(item.name));
  return drink?.name ?? null;
}

function rotate<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return items;
  return items.map((_, index) => items[(index + offset) % items.length]);
}

/**
 * Build the calendar. Takes the menu as a parameter so the tests can pass a
 * fixed one and get a stable answer.
 */
export function buildCalendar(menu: TodayMenu, options: { start?: Date } = {}): ContentCalendar {
  const start = options.start ?? sydneyNow();
  const all = menu.categories.flatMap((group) => group.items);
  const heroes = rotate(menu.featured.length > 0 ? menu.featured : all.slice(0, 7), 0);
  const currency = menu.currency;

  const days: CalendarDay[] = THEMES.map((theme, index) => {
    const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
    const hero = heroes[index % Math.max(1, heroes.length)] ?? null;
    const pairing = pickPairing(menu, hero);
    const price = hero ? money(hero.price_cents, currency) : "";
    const orderLine = `Order: ${menu.baseUrl}/menu`;

    let caption = "";
    let hook = "";
    let cta = "";

    switch (index) {
      case 0:
        // Monday: range, not a hero dish.
        hook = `${menu.weekday === "Monday" ? "This" : "Next"} week's kitchen line-up`;
        caption = [
          hook,
          "",
          `${menu.totalDishes} dishes on the menu this week, cooked to order.`,
          hero ? `Starting with ${hero.name} ${price}.` : "",
          "",
          "Biryani, karahi, naan from the tandoor — the same dishes you would get at the table.",
          "",
          orderLine,
          `Delivery ${menu.deliveryArea}, or collect at the counter.`,
        ]
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        cta = "See the full menu";
        break;

      case 1:
        hook = hero ? `${hero.name}, and why it takes the time it takes` : "How the kitchen works";
        caption = [
          hook,
          "",
          hero
            ? `${hero.name}. ${price}. Nothing rushed.`
            : `Everything on the menu is cooked to order.`,
          pairing ? `Try it with ${pairing}.` : "",
          "",
          "Good food is mostly patience: the right heat, the right time, and not taking shortcuts because someone is hungry.",
          "",
          orderLine,
        ]
          .filter(Boolean)
          .join("\n");
        cta = "Order for tonight";
        break;

      case 2:
        hook = "What our customers keep saying";
        caption = [
          hook,
          "",
          "The best advertising is a customer who came back a second time.",
          "",
          hero ? `Most ordered lately: ${hero.name} ${price}.` : "",
          "",
          "If we got it right, tell someone. If we did not, tell us — we read every message.",
          "",
          orderLine,
        ]
          .filter(Boolean)
          .join("\n");
        cta = "Leave a review or order again";
        break;

      case 3:
        hook = "Friday and Saturday fill up";
        caption = [
          hook,
          "",
          "Not a sales line — it is what the kitchen looks like by 6pm on a Friday.",
          "",
          "Pre-order and pick your time. That is the whole trick.",
          hero ? `This week: ${hero.name} ${price}.` : "",
          "",
          orderLine,
          `Delivery ${menu.deliveryArea}.`,
        ]
          .filter(Boolean)
          .join("\n");
        cta = "Pre-order for Friday";
        break;

      case 4:
        hook = hero ? `${hero.name} — ${price}` : "The Friday order";
        caption = [
          hook,
          "",
          hero
            ? `The dish most people order, and the one worth planning your Friday around.`
            : "The dish most people order on a Friday.",
          pairing ? `Add ${pairing} and it is a proper meal.` : "",
          "",
          `Order before the evening rush: ${menu.baseUrl}/menu`,
          `Delivery ${menu.deliveryArea}, or collect at the counter.`,
        ]
          .filter(Boolean)
          .join("\n");
        cta = "Order now";
        break;

      case 5:
        hook = "Feeding the whole table";
        caption = [
          hook,
          "",
          "Saturday is not one person ordering one dish. It is six people and one decision.",
          "",
          hero ? `Start with ${hero.name} ${price}, then build around it.` : "",
          pairing ? `${pairing} covers the vegetarians at the table.` : "",
          "",
          "Message us the number of people and we will tell you what to order — no guessing, no waste.",
          "",
          orderLine,
        ]
          .filter(Boolean)
          .join("\n");
        cta = "Message us your table size";
        break;

      default:
        hook = "Slow Sunday";
        caption = [
          hook,
          "",
          "The end of the week deserves a slower meal and a proper cup of chai.",
          "",
          hero ? `${hero.name} ${price}, if you want the easy answer.` : "",
          "",
          "No rush today. Order when you are ready — we will keep it warm.",
          "",
          orderLine,
        ]
          .filter(Boolean)
          .join("\n");
        cta = "Order a slow Sunday lunch";
        break;
    }

    return {
      dayNumber: index + 1,
      weekday: theme.weekday,
      date: isoDate(date),
      theme: theme.theme,
      angle: theme.angle,
      caption: caption.trim(),
      hook,
      cta,
      hashtags: menuHashtags(menu),
      channels: CHANNELS_BY_DAY[index] ?? ["facebook", "instagram"],
      bestTime: theme.bestTime,
      featureDish: hero?.name ?? null,
      pairing,
      action: theme.action,
    };
  });

  return {
    generatedFor: isoDate(start),
    restaurantName: menu.restaurantName,
    deliveryArea: menu.deliveryArea,
    baseUrl: menu.baseUrl,
    totalDishes: menu.totalDishes,
    days,
    notes: [
      "Captions are drafts. Read each one before it goes out — a wrong price on a live post costs more than the minute it takes to check.",
      `Prices are read from the live menu on ${isoDate(start)}. If a price changes, regenerate the calendar.`,
      "Halal is worth stating once a week, not in every post. It is a reason to choose us, not the only reason.",
      "Never promise a delivery time you have not checked. The kitchen is in Whalan; the zones decide where we go.",
      "One post a day is plenty. Two mediocre posts do worse than one good one.",
    ],
  };
}

/** Build the calendar from the database. */
export async function contentCalendar(db: Db, baseUrl: string, start?: Date): Promise<ContentCalendar> {
  const menu = await todayMenu(db, baseUrl);
  return buildCalendar(menu, { start });
}

/**
 * Render the calendar as the Markdown file the owner asked for.
 *
 * Kept as a pure function of the calendar so the file and any on-screen view
 * cannot disagree.
 */
export function calendarMarkdown(calendar: ContentCalendar, settings: Record<string, string>): string {
  const address = settingValue(settings, "restaurant_address", "1/53 Bulolo Dr, Whalan NSW 2770");
  const phone = settingValue(settings, "restaurant_phone", "0461 382 923");
  const whatsapp = settingValue(settings, "whatsapp_display_number", "+61410913853");

  const lines: string[] = [
    `# 7-day content calendar — ${calendar.restaurantName}`,
    "",
    `Generated for **${calendar.generatedFor}** from the live menu. ${calendar.totalDishes} dishes are on sale.`,
    "",
    "| | |",
    "|---|---|",
    `| Kitchen | ${address} |`,
    `| Delivery | ${calendar.deliveryArea} |`,
    `| Phone | ${phone} |`,
    `| WhatsApp | ${whatsapp} |`,
    `| Website | ${calendar.baseUrl} |`,
    "",
    "> This file is generated. Re-run `npm run marketing:calendar` after a menu change — editing it by hand means the next run silently undoes your work.",
    "",
    "## Before you post anything",
    "",
    ...calendar.notes.map((note) => `- ${note}`),
    "",
    "## The week",
    "",
    "| Day | Date | Theme | Post at | Channels | Built around |",
    "|---|---|---|---|---|---|",
    ...calendar.days.map(
      (day) =>
        `| ${day.weekday} | ${day.date} | ${day.theme} | ${day.bestTime} | ${day.channels.join(", ")} | ${day.featureDish ?? "—"} |`,
    ),
    "",
    "---",
    "",
  ];

  for (const day of calendar.days) {
    lines.push(
      `## ${day.weekday} ${day.date} — ${day.theme}`,
      "",
      `**The idea.** ${day.angle}`,
      "",
      `**Post at** ${day.bestTime} · **Channels** ${day.channels.join(", ")}`,
      "",
      day.featureDish ? `**Built around** ${day.featureDish}${day.pairing ? ` · paired with ${day.pairing}` : ""}` : "",
      day.featureDish ? "" : "",
      "**Caption**",
      "",
      "```text",
      day.caption,
      "```",
      "",
      `**Hook:** ${day.hook}`,
      "",
      `**Call to action:** ${day.cta}`,
      "",
      `**Hashtags:** ${day.hashtags.map((tag) => `#${tag}`).join(" ")}`,
      "",
      `**Do this:** ${day.action}`,
      "",
      "---",
      "",
    );
  }

  lines.push(
    "## Weekly rhythm, and why",
    "",
    "| Day | Job of the post |",
    "|---|---|",
    ...THEMES.map((theme) => `| ${theme.weekday} | ${theme.theme} — ${theme.angle.split(".")[0]}. |`),
    "",
    "## What this calendar deliberately does not do",
    "",
    "- **It does not promise results.** No post here guarantees orders. It guarantees a consistent, honest presence, which is the part you control.",
    "- **It does not invent discounts.** Discounts train customers to wait for them. The calendar sells the food instead.",
    "- **It does not write fake reviews.** The Wednesday slot is for a real review, or it is skipped.",
    "",
  );

  // Keep the blank lines: they are what separates sections in Markdown. Only
  // collapse runs of three or more, which come from optional fields that were
  // empty on this menu.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
