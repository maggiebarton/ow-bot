import assert from "node:assert/strict";
import test from "node:test";
import { BlizzardRatesClient, BlizzardRatesError, competitiveTierFromDivision } from "../src/blizzard-rates.js";

test("maps profile divisions to Blizzard statistics tiers", () => {
  assert.equal(competitiveTierFromDivision("silver"), "Silver");
  assert.equal(competitiveTierFromDivision("Champion"), "Grandmaster");
  assert.equal(competitiveTierFromDivision("unknown"), undefined);
});

test("loads and caches Blizzard hero rates", async () => {
  let calls = 0;
  const rows = JSON.stringify([{
    cells: { name: "Doomfist", winrate: 51.3, pickrate: 4.2, banrate: 5 },
  }]).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const fetcher = async () => {
    calls++;
    return new Response(`<blz-data-table allrows="${rows}"></blz-data-table>`);
  };
  const client = new BlizzardRatesClient("https://example.test/rates/", fetcher as typeof fetch);

  assert.deepEqual((await client.competitive("Silver", "PC"))[0], {
    name: "Doomfist", winrate: 51.3, pickrate: 4.2, banrate: 5,
  });
  await client.competitive("Silver", "PC");
  assert.equal(calls, 1);
});

test("reports malformed Blizzard rate data", async () => {
  const fetcher = async () => new Response("<html></html>");
  const client = new BlizzardRatesClient("https://example.test/rates/", fetcher as typeof fetch);
  await assert.rejects(client.competitive("Silver", "PC"), BlizzardRatesError);
});
