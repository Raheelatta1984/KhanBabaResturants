import assert from "node:assert/strict";
import { automaticTheme } from "../lib/cultural-theme";
// Midnight in Sydney may fall on the preceding UTC date.
assert.deepEqual(automaticTheme(new Date("2026-08-13T14:00:00Z")), { theme: "lahore", occasion: "Pakistan Independence Day" });
assert.deepEqual(automaticTheme(new Date("2026-08-15T02:00:00Z")), { theme: "heritage", occasion: "India Independence Day" });
assert.equal(automaticTheme(new Date("2026-11-20T02:00:00Z")).occasion, "Royal lounge weekend");
assert.equal(automaticTheme(new Date("2026-11-17T02:00:00Z")).occasion, "Lahore heritage");
console.log("Cultural calendar checks passed");
