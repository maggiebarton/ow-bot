import assert from "node:assert/strict";
import test from "node:test";
import { displayBattletag, OverfastClient, OverfastError } from "../src/overfast.js";

const api = new OverfastClient("https://example.test");
test("normalizes a BattleTag for OverFast", () => {
  assert.equal(api.normalizeBattletag("TeKrop#2217"), "TeKrop-2217");
  assert.equal(api.normalizeBattletag("TeKrop-2217"), "TeKrop-2217");
  assert.equal(displayBattletag("TeKrop-2217"), "TeKrop#2217");
});
test("rejects incomplete names", () => assert.throws(() => api.normalizeBattletag("TeKrop"), OverfastError));

test("includes OverFast's next player check time in 404 errors", async () => {
  const fetcher = async () => new Response(JSON.stringify({
    error: "Player not found",
    retry_after: 1626,
    next_check_at: 1784220405,
    check_count: 2,
  }), { status: 404, headers: { "content-type": "application/json" } });
  const client = new OverfastClient("https://example.test", fetcher as typeof fetch);

  await assert.rejects(client.summary("magsauce-11831"), error => {
    assert.ok(error instanceof OverfastError);
    assert.match(error.message, /<t:1784220405:R>/);
    assert.match(error.message, /<t:1784220405:f>/);
    return true;
  });
});
