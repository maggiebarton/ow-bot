import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LinkRecord, Platform } from "./types.js";

export class LinkStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const resolved = resolve(path);
    mkdirSync(dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
    `);
    this.migrate();
  }

  private migrate(): void {
    const existing = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'player_links'").get();
    if (existing) {
      const columns = this.db.prepare("PRAGMA table_info(player_links)").all() as Array<Record<string, string>>;
      if (!columns.some(column => column.name === "account_id")) {
        this.db.exec(`
          BEGIN;
          ALTER TABLE player_links RENAME TO player_links_legacy;
          ${playerLinksSchema()}
          INSERT INTO player_links (guild_id, discord_user_id, label, is_default, player_id, battletag, platform, linked_at)
            SELECT guild_id, discord_user_id, 'main', 1, player_id, battletag, platform, linked_at
            FROM player_links_legacy;
          DROP TABLE player_links_legacy;
          COMMIT;
        `);
        return;
      }
    }
    this.db.exec(playerLinksSchema());
  }

  upsert(guildId: string, userId: string, label: string, playerId: string, battletag: string, platform: Platform, makeDefault = false): LinkRecord {
    const normalizedLabel = normalizeLabel(label);
    const hasDefault = this.get(guildId, userId);
    const existingLabel = this.get(guildId, userId, normalizedLabel);
    const isDefault = makeDefault || !hasDefault || Boolean(existingLabel?.isDefault);
    this.db.exec("BEGIN");
    try {
      if (isDefault) this.db.prepare("UPDATE player_links SET is_default = 0 WHERE guild_id = ? AND discord_user_id = ?").run(guildId, userId);
      this.db.prepare(`
        INSERT INTO player_links (guild_id, discord_user_id, label, is_default, player_id, battletag, platform, linked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, discord_user_id, label) DO UPDATE SET
          is_default = excluded.is_default,
          player_id = excluded.player_id,
          battletag = excluded.battletag,
          platform = excluded.platform,
          linked_at = excluded.linked_at
      `).run(guildId, userId, normalizedLabel, isDefault ? 1 : 0, playerId, battletag, platform, new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(guildId, userId, normalizedLabel)!;
  }

  get(guildId: string, userId: string, label?: string): LinkRecord | undefined {
    const row = label
      ? this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND discord_user_id = ? AND label = ?").get(guildId, userId, normalizeLabel(label))
      : this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND discord_user_id = ? AND is_default = 1").get(guildId, userId);
    return row ? mapRow(row as Record<string, string | number>) : undefined;
  }

  getById(guildId: string, accountId: number): LinkRecord | undefined {
    const row = this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND account_id = ?").get(guildId, accountId);
    return row ? mapRow(row as Record<string, string | number>) : undefined;
  }

  list(guildId: string, userId?: string): LinkRecord[] {
    const rows = userId
      ? this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND discord_user_id = ? ORDER BY is_default DESC, linked_at, account_id").all(guildId, userId)
      : this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND is_default = 1 ORDER BY linked_at, account_id").all(guildId);
    return (rows as Array<Record<string, string | number>>).map(mapRow);
  }

  listAll(guildId: string): LinkRecord[] {
    const rows = this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? ORDER BY linked_at, account_id").all(guildId);
    return (rows as Array<Record<string, string | number>>).map(mapRow);
  }

  remove(guildId: string, userId: string, label?: string): LinkRecord | undefined {
    const link = this.get(guildId, userId, label);
    if (!link) return undefined;
    this.db.prepare("DELETE FROM player_links WHERE account_id = ?").run(link.accountId);
    if (link.isDefault) {
      const next = this.db.prepare("SELECT account_id FROM player_links WHERE guild_id = ? AND discord_user_id = ? ORDER BY linked_at LIMIT 1")
        .get(guildId, userId) as { account_id: number } | undefined;
      if (next) this.db.prepare("UPDATE player_links SET is_default = 1 WHERE account_id = ?").run(next.account_id);
    }
    return link;
  }
}

function playerLinksSchema() {
  return `
      CREATE TABLE IF NOT EXISTS player_links (
        account_id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        label TEXT NOT NULL COLLATE NOCASE,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        player_id TEXT NOT NULL,
        battletag TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('pc', 'console')),
        linked_at TEXT NOT NULL,
        UNIQUE (guild_id, discord_user_id, label)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_default_link_per_user
        ON player_links (guild_id, discord_user_id) WHERE is_default = 1;
  `;
}

function normalizeLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,20}$/.test(normalized)) throw new Error("Account labels must be 1–20 letters, numbers, underscores, or hyphens.");
  return normalized;
}

function mapRow(row: Record<string, string | number>): LinkRecord {
  return {
    accountId: Number(row.account_id), guildId: String(row.guild_id), discordUserId: String(row.discord_user_id),
    label: String(row.label), isDefault: Boolean(row.is_default), playerId: String(row.player_id),
    battletag: String(row.battletag), platform: row.platform as Platform, linkedAt: String(row.linked_at),
  };
}
