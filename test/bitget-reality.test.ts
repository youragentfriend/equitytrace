import assert from "node:assert/strict";
import test from "node:test";
import { sortDatedEvents } from "../src/lib/event-order.ts";

test("corporate events show the nearest upcoming date before distant forecasts and historical records", () => {
  const events = sortDatedEvents([
    { type: "SUSPENSION", label: "Old suspension", date: "2016-01-01" },
    { type: "EARNINGS", label: "Distant forecast", date: "2029-06-29" },
    { type: "DIVIDEND", label: "Upcoming dividend", date: "2026-12-09" },
    { type: "DIVIDEND", label: "Recent dividend", date: "2026-09-01" },
  ], new Date("2026-09-29T00:00:00.000Z").getTime());

  assert.deepEqual(events.map((event) => event.label), ["Upcoming dividend", "Distant forecast", "Recent dividend", "Old suspension"]);
});
