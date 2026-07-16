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
      CREATE TABLE IF NOT EXISTS player_links (
        guild_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        battletag TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('pc', 'console')),
        linked_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, discord_user_id)
      );
    `);
  }

  upsert(guildId: string, userId: string, playerId: string, battletag: string, platform: Platform): void {
    this.db.prepare(`
      INSERT INTO player_links VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET
        player_id = excluded.player_id,
        battletag = excluded.battletag,
        platform = excluded.platform,
        linked_at = excluded.linked_at
    `).run(guildId, userId, playerId, battletag, platform, new Date().toISOString());
  }

  get(guildId: string, userId: string): LinkRecord | undefined {
    const row = this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND discord_user_id = ?")
      .get(guildId, userId) as Record<string, string> | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(guildId: string): LinkRecord[] {
    const rows = this.db.prepare("SELECT * FROM player_links WHERE guild_id = ? ORDER BY linked_at")
      .all(guildId) as Record<string, string>[];
    return rows.map(mapRow);
  }

  remove(guildId: string, userId: string): boolean {
    return this.db.prepare("DELETE FROM player_links WHERE guild_id = ? AND discord_user_id = ?")
      .run(guildId, userId).changes > 0;
  }
}

function mapRow(row: Record<string, string>): LinkRecord {
  return {
    guildId: row.guild_id!, discordUserId: row.discord_user_id!, playerId: row.player_id!,
    battletag: row.battletag!, platform: row.platform as Platform, linkedAt: row.linked_at!,
  };
}
