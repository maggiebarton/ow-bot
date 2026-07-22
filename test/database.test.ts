import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { LinkStore } from "../src/database.js";

function databasePath() {
  return join(mkdtempSync(join(tmpdir(), "oversauce-test-")), "links.db");
}

test("stores multiple accounts and maintains one default", () => {
  const store = new LinkStore(databasePath());
  const main = store.upsert("guild", "user", "main", "Main-1", "Main#1", "pc");
  const alt = store.upsert("guild", "user", "Alt", "Alt-2", "Alt#2", "console");

  assert.equal(main.isDefault, true);
  assert.equal(alt.isDefault, false);
  assert.equal(store.get("guild", "user")?.label, "main");
  assert.deepEqual(store.list("guild", "user").map(link => link.label), ["main", "alt"]);
  assert.deepEqual(store.list("guild").map(link => link.playerId), ["Main-1"]);
  assert.deepEqual(store.listAll("guild").map(link => link.playerId), ["Main-1", "Alt-2"]);

  const promoted = store.upsert("guild", "user", "alt", "Alt-2", "Alt#2", "console", true);
  assert.equal(promoted.isDefault, true);
  assert.equal(store.get("guild", "user")?.label, "alt");
  assert.equal(store.get("guild", "user", "main")?.isDefault, false);
});

test("removing the default promotes a remaining account", () => {
  const store = new LinkStore(databasePath());
  store.upsert("guild", "user", "main", "Main-1", "Main#1", "pc");
  store.upsert("guild", "user", "alt", "Alt-2", "Alt#2", "pc");

  assert.equal(store.remove("guild", "user")?.label, "main");
  assert.equal(store.get("guild", "user")?.label, "alt");
  assert.equal(store.get("guild", "user")?.isDefault, true);
});

test("migrates legacy links to default main accounts", () => {
  const path = databasePath();
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE player_links (
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      battletag TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('pc', 'console')),
      linked_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, discord_user_id)
    );
    INSERT INTO player_links VALUES ('guild', 'user', 'Player-123', 'Player#123', 'pc', '2026-01-01T00:00:00.000Z');
  `);
  legacy.close();

  const migrated = new LinkStore(path).get("guild", "user");
  assert.equal(migrated?.label, "main");
  assert.equal(migrated?.isDefault, true);
  assert.equal(migrated?.battletag, "Player#123");
});
