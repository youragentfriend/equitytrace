import assert from "node:assert/strict";
import test from "node:test";
import { createRealityRequestScheduler } from "../src/lib/reality-request-scheduler.ts";

test("different Reality endpoints run concurrently while identical requests share one call", async () => {
  const schedule = createRealityRequestScheduler(20);
  let active = 0;
  let peak = 0;
  let earningsCalls = 0;
  const fetcher = async (kind: string) => {
    active++;
    peak = Math.max(peak, active);
    if (kind === "earnings") earningsCalls++;
    await new Promise((resolve) => setTimeout(resolve, 25));
    active--;
    return kind;
  };

  const [earnings, sameEarnings, dividends] = await Promise.all([
    schedule("/earnings?code=MSFT", () => fetcher("earnings")),
    schedule("/earnings?code=MSFT", () => fetcher("earnings")),
    schedule("/dividends?code=MSFT", () => fetcher("dividends")),
  ]);

  assert.deepEqual([earnings, sameEarnings, dividends], ["earnings", "earnings", "dividends"]);
  assert.equal(earningsCalls, 1);
  assert.equal(peak, 2);
});

test("different queries to one Reality endpoint retain the start-rate interval", async () => {
  const interval = 25;
  const schedule = createRealityRequestScheduler(interval);
  const starts: number[] = [];
  await Promise.all([
    schedule("/earnings?code=MSFT", async () => { starts.push(Date.now()); return "MSFT"; }),
    schedule("/earnings?code=NVDA", async () => { starts.push(Date.now()); return "NVDA"; }),
  ]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= interval - 2, `starts separated by ${starts[1] - starts[0]} ms`);
});

test("same-endpoint requests may overlap after their paced starts", async () => {
  const schedule = createRealityRequestScheduler(20);
  let active = 0;
  let peak = 0;
  const starts: number[] = [];
  const request = async () => {
    starts.push(Date.now());
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 55));
    active--;
    return true;
  };
  await Promise.all([schedule("/earnings?code=MSFT", request), schedule("/earnings?code=NVDA", request)]);
  assert.ok(starts[1] - starts[0] >= 18);
  assert.equal(peak, 2);
});
