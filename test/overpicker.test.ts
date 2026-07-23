import assert from "node:assert/strict";
import test from "node:test";
import { OverpickerClient, OverpickerError } from "../src/overpicker.js";

test("loads and caches Overpicker counter data", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify([{
      name: "D.Va",
      general_rol: "Tank",
      countered_by: [{ name: "Wuyang", score: 20 }],
      best_synergies: [{ name: "Echo", score: 20 }],
    }]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new OverpickerClient("https://example.test", fetcher as typeof fetch);

  assert.equal((await client.heroes())[0]?.countered_by[0]?.name, "Wuyang");
  assert.equal((await client.heroes())[0]?.best_synergies[0]?.name, "Echo");
  await client.heroes();
  assert.equal(calls, 1);
});

test("reports an unavailable Overpicker service", async () => {
  const fetcher = async () => new Response("", { status: 503 });
  const client = new OverpickerClient("https://example.test", fetcher as typeof fetch);
  await assert.rejects(client.heroes(), OverpickerError);
});

test("loads and caches the full synergy matrix", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response('<script>const synergyMatrix = {"Ana":{"D.Va":20,"Ashe":10}};</script>');
  };
  const client = new OverpickerClient("https://api.example.test", fetcher as typeof fetch, "https://example.test");

  assert.equal((await client.synergyMatrix()).Ana?.["D.Va"], 20);
  await client.synergyMatrix();
  assert.equal(calls, 1);
});

test("loads and caches the full counter matrix", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response('<script>const counterMatrix = {"Ana":{"D.Va":20,"Ashe":10}};</script>');
  };
  const client = new OverpickerClient("https://api.example.test", fetcher as typeof fetch, "https://example.test");

  assert.equal((await client.counterMatrix()).Ana?.["D.Va"], 20);
  await client.counterMatrix();
  assert.equal(calls, 1);
});
