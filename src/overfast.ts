import type { CareerStats, Gamemode, Hero, Platform, PlayerStatsSummary, PlayerSummary } from "./types.js";

export class OverfastError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

interface PlayerNotFoundResponse {
  error?: string;
  retry_after?: number;
  next_check_at?: number;
  check_count?: number;
}

export class OverfastClient {
  private heroCache?: { expires: number; heroes: Hero[] };
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  normalizeBattletag(input: string): string {
    const trimmed = input.trim();
    if (!/^[^#\s-]+(?:#|-)[0-9]+$/.test(trimmed)) {
      throw new OverfastError("Use a full BattleTag such as PlayerName#1234.");
    }
    return trimmed.replace("#", "-");
  }

  async summary(playerId: string): Promise<PlayerSummary> {
    return this.get(`/players/${encodeURIComponent(playerId)}/summary`);
  }

  async stats(playerId: string, platform: Platform, gamemode: Gamemode): Promise<PlayerStatsSummary> {
    const query = new URLSearchParams({ platform, gamemode });
    return this.get(`/players/${encodeURIComponent(playerId)}/stats/summary?${query}`);
  }

  async career(playerId: string, platform: Platform, gamemode: Gamemode, hero: string): Promise<CareerStats> {
    const query = new URLSearchParams({ platform, gamemode, hero });
    return this.get(`/players/${encodeURIComponent(playerId)}/stats/career?${query}`);
  }

  async heroes(): Promise<Hero[]> {
    if (this.heroCache && this.heroCache.expires > Date.now()) return this.heroCache.heroes;
    const heroes = await this.get<Hero[]>("/heroes");
    this.heroCache = { heroes, expires: Date.now() + 24 * 60 * 60 * 1000 };
    return heroes;
  }

  private async get<T>(path: string): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(12_000) }); }
    catch { throw new OverfastError("OverFast did not respond. Try again in a moment."); }
    if (!response.ok) {
      if (response.status === 404) {
        const details = await parseError<PlayerNotFoundResponse>(response);
        let message = "That player was not found. Check the BattleTag and make sure the career profile is public.";
        if (details?.next_check_at) {
          message += ` OverFast can check Blizzard again <t:${details.next_check_at}:R> (<t:${details.next_check_at}:f>).`;
        } else if (details?.retry_after) {
          message += ` OverFast can check Blizzard again in about ${formatWait(details.retry_after)}.`;
        }
        throw new OverfastError(message, 404);
      }
      if (response.status === 429 || response.status === 503) throw new OverfastError("OverFast is rate-limited right now. Try again shortly.", response.status);
      throw new OverfastError(`OverFast returned an error (${response.status}).`, response.status);
    }
    return response.json() as Promise<T>;
  }
}

async function parseError<T>(response: Response): Promise<T | undefined> {
  try { return await response.json() as T; }
  catch { return undefined; }
}

function formatWait(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} hour${hours === 1 ? "" : "s"}${remainder ? ` ${remainder} minutes` : ""}`;
}

export function displayBattletag(playerId: string): string {
  return playerId.replace(/-(\d+)$/, "#$1");
}
