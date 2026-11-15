// AUTO-GENERATED from whats-new/pr-<n>.json — do not edit by hand.
// Regenerate with: npm run notes:build
//
// These notes are imported, not read from disk, so they are part of the server
// bundle on every host. See scripts/generate-release-notes.mjs for why.

export type BundledReleaseNote = {
  prNumber: number;
  note: {
    title: string;
    summary: string;
    body?: string;
    category?: "feature" | "improvement" | "fix" | "portal" | "ops";
    version?: string;
  };
};

export const RELEASE_NOTES: BundledReleaseNote[] = [
  {
    "prNumber": 20,
    "note": {
      "title": "The kitchen is in Whalan 2770, not the Sydney CBD",
      "summary": "The stored address said Pitt Street. Delivery was quoted from a point 39 km from the kitchen, and postcodes 40 km away were treated as nearby.",
      "body": "Every consequence of the wrong address was wrong. The kitchen is 1/53 Bulolo Dr, Whalan NSW 2770 — the delivery zones are redrawn around it, and an estimated pin is no longer trusted when pricing a delivery. Captions no longer promise delivery across Sydney.",
      "category": "fix",
      "version": "3.3.0"
    }
  },
  {
    "prNumber": 21,
    "note": {
      "title": "Answer which WhatsApp token works, and create the catalogue for you",
      "summary": "A stale Vercel variable silently beat a good token saved in the portal: the portal showed a green tick, Meta answered error 190, and changing the token did nothing.",
      "body": "Diagnostics now tests every token the app can see — the portal value and both Vercel aliases — and prints a verdict per token. Rotation became a toggle: WHATSAPP_ACCESS_TOKEN_NEW is a second alias, so trying a new token and falling back are one click each, with no deploy. Any single credential can be pinned to Vercel or the portal. The catalogue can be created from the portal instead of hunting a Content ID out of a Commerce Manager URL.",
      "category": "feature",
      "version": "3.4.0"
    }
  },
  {
    "prNumber": 22,
    "note": {
      "title": "A 7-day content calendar that cannot go stale",
      "summary": "Generated from the live menu and the delivery zones, so it cannot drift. Seven days, each with a different job.",
      "body": "A calendar written once keeps saying 'across Sydney' for a year after the kitchen moves. This one reads the menu the kitchen is actually selling: every day carries a caption, hook, call to action, hashtags, posting time, channels and a genuinely different pairing. Regenerate with npm run marketing:calendar. Two bugs surfaced and fixed: the proven-token tick fingerprinted the resolved token rather than the one that won, so it could tick a token that did not work; and 'Create catalogue' required whatsapp_business_id, which had no input anywhere.",
      "category": "feature",
      "version": "3.5.0"
    }
  },
  {
    "prNumber": 24,
    "note": {
      "title": "A log that tells you what to do, and a Marketing tab you can actually click",
      "summary": "Two things were missing and they were the same kind of thing: knowledge that existed but could not be reached. The Marketing console was built and never linked. And every fault was recorded as an event in its own table with no remedy attached — which is why the WhatsApp 190 needed you to already know the answer.",
      "body": "The Marketing console now has its own group in the sidebar, with direct links to the integration diagnostics and the content calendar. The page always existed at /admin/marketing; nothing pointed at it. New Operational log at /admin/logs. Each row is one finding with a stable reference (LOG-WA-TOKEN-1245), a severity, the evidence behind it, and the course of action written out in order. The log is a real table, not a view. A finding that opens again keeps its reference and bumps its occurrence count instead of creating a duplicate. Findings cover the faults that have actually cost time here: a shadowed Vercel token, an unproven token, a missing catalogue, a hidden dish with negative stock, an address that is not the Whalan kitchen, orders stuck for 90 minutes. Closing a finding requires a note. A row closed to clear the screen is indistinguishable from one that was fixed. Resolved stays resolved. A fault the owner has knowingly accepted must not flip itself back to open on the next audit. The audit runs from the page and the API, not on boot. Auditing on boot deadlocked the first request: the audit reads settings, settings call getDb(), and getDb() was still awaiting the very call that would run the audit.",
      "category": "feature",
      "version": "3.6.0"
    }
  },
  {
    "prNumber": 25,
    "note": {
      "title": "Changes now reach the screen: a version on every page, a menu you can read, and a log of every action",
      "summary": "Finished work was not reaching the screen. Release notes never published on the live site, the admin menu ran its links together so Marketing was hard to find, and no page said which version was running. All fixed, and every staff action is now logged with its result and the next step.",
      "body": "Why new work could not be seen. Release notes were read from a folder that does not exist on the live server, so nothing after version 3.5.0 was published there; they are now compiled into the build, and the build check runs without that folder so the same fault cannot pass again. The admin sidebar showed its links as one run-on paragraph, taller than a laptop screen and cut off on a phone; it is now a list in five groups with its own scroll, and sits behind an Admin menu button on a phone or tablet. The staff top bar had no Marketing or Logs link, and on a tablet it hid whatever did not fit; it now has both and wraps instead of hiding. The Command centre had no Marketing or Operational log tile; it and the sidebar are now drawn from one list, and a test fails if a page exists that the menu does not link to. Two Marketing links pointed at sections that did not exist; they do now, and the seven-day content calendar has a screen. Delivery & payments, Integrations and Tables & QR codes were wider than a laptop screen and scrolled sideways; they now fit, and so does Marketing on a phone. Every page names the version that served it: the public footer, the staff bar, the What's new admin page and /api/health. A setting saved in the portal could go on showing its old value from another server instance; pages now read settings fresh on every request. The operational log has two parts. Findings are what is wrong right now: the audit runs when the page is opened instead of waiting for a button, reopens a fault that was marked resolved but is still there, and closes one that has gone. It also runs security checks that nothing ran before. The action log is new: one line for every sign-in, order step, menu, price, setting and publishing action, with who did it, whether it worked, a reference to quote, and the next step for a named owner. Passwords, tokens and setting values are never stored, and customer details are withheld. Both parts export as plain text, CSV or NDJSON.",
      "category": "portal",
      "version": "3.7.0"
    }
  }
];
