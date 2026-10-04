import assert from "node:assert/strict";
import test from "node:test";
import { runResearchBatch } from "../src/lib/research-batch.ts";

test("independent selected requests run concurrently, retain order, and isolate failures", async () => {
  let active = 0;
  let peak = 0;
  const result = await runResearchBatch(["slow", "broken", "fast"], async (name) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, name === "slow" ? 20 : 5));
    active--;
    if (name === "broken") throw new Error("source unavailable");
    return name;
  }, 2);
  assert.equal(peak, 2);
  assert.deepEqual(result.map((item) => item.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.equal(result[0].status === "fulfilled" && result[0].value, "slow");
  assert.equal(result[2].status === "fulfilled" && result[2].value, "fast");
});
