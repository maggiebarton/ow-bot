export type CompetitiveTier = "All" | "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Master" | "Grandmaster";
export type StatsInput = "PC" | "Console";

export interface HeroRate {
  name: string;
  winrate: number;
  pickrate: number;
  banrate: number;
}

interface BlizzardRateRow {
  cells?: {
    name?: string;
    winrate?: number;
    pickrate?: number;
    banrate?: number;
  };
}

export class BlizzardRatesError extends Error {}

export function competitiveTierFromDivision(division: string | undefined): CompetitiveTier | undefined {
  if (!division) return undefined;
  const normalized = division.toLowerCase();
  if (normalized === "champion") return "Grandmaster";
  const tier = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Grandmaster"].includes(tier)
    ? tier as CompetitiveTier
    : undefined;
}

export class BlizzardRatesClient {
  private cache = new Map<string, { expires: number; rates: HeroRate[] }>();

  constructor(
    private readonly baseUrl = "https://overwatch.blizzard.com/en-us/rates/",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async competitive(tier: CompetitiveTier, input: StatsInput): Promise<HeroRate[]> {
    const cacheKey = `${tier}|${input}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.rates;

    const query = new URLSearchParams({
      input,
      map: "all-maps",
      region: "Americas",
      role: "All",
      rq: "2",
      tier,
    });
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}?${query}`, { signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new BlizzardRatesError("Blizzard's hero statistics did not respond. Try again in a moment.");
    }
    if (!response.ok) throw new BlizzardRatesError(`Blizzard's hero statistics returned an error (${response.status}).`);

    const html = await response.text();
    const encodedRows = html.match(/\ballrows="([^"]+)"/)?.[1];
    if (!encodedRows) throw new BlizzardRatesError("Blizzard's hero statistics could not be read.");

    let rows: BlizzardRateRow[];
    try {
      rows = JSON.parse(decodeHtmlAttribute(encodedRows)) as BlizzardRateRow[];
    } catch {
      throw new BlizzardRatesError("Blizzard's hero statistics could not be read.");
    }
    const rates = rows.flatMap(row => {
      const cells = row.cells;
      return cells?.name && typeof cells.winrate === "number" && typeof cells.pickrate === "number" && typeof cells.banrate === "number"
        ? [{ name: cells.name, winrate: cells.winrate, pickrate: cells.pickrate, banrate: cells.banrate }]
        : [];
    });
    this.cache.set(cacheKey, { rates, expires: Date.now() + 60 * 60 * 1000 });
    return rates;
  }
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
