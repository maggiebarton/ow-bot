export interface CounterMatchup {
  name: string;
  score: number;
}

export interface OverpickerHero {
  name: string;
  general_rol: string;
  countered_by: CounterMatchup[];
  best_synergies: CounterMatchup[];
}

export type SynergyMatrix = Record<string, Record<string, number>>;

export class OverpickerError extends Error {}

export class OverpickerClient {
  private cache?: { expires: number; heroes: OverpickerHero[] };
  private synergyCache?: { expires: number; matrix: SynergyMatrix };
  private counterCache?: { expires: number; matrix: SynergyMatrix };

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly siteUrl = "https://overpicker.com",
  ) {}

  async heroes(): Promise<OverpickerHero[]> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.heroes;

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/hero-info`, { signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new OverpickerError("Overpicker did not respond. Try again in a moment.");
    }
    if (!response.ok) throw new OverpickerError(`Overpicker returned an error (${response.status}).`);

    const heroes = await response.json() as OverpickerHero[];
    this.cache = { heroes, expires: Date.now() + 6 * 60 * 60 * 1000 };
    return heroes;
  }

  async synergyMatrix(): Promise<SynergyMatrix> {
    if (this.synergyCache && this.synergyCache.expires > Date.now()) return this.synergyCache.matrix;

    let response: Response;
    try {
      response = await this.fetcher(`${this.siteUrl}/synergies`, { signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new OverpickerError("Overpicker did not respond. Try again in a moment.");
    }
    if (!response.ok) throw new OverpickerError(`Overpicker returned an error (${response.status}).`);

    const html = await response.text();
    const match = html.match(/const synergyMatrix = (\{.*\});/);
    if (!match?.[1]) throw new OverpickerError("Overpicker's synergy data could not be read.");

    let matrix: SynergyMatrix;
    try {
      matrix = JSON.parse(match[1]) as SynergyMatrix;
    } catch {
      throw new OverpickerError("Overpicker's synergy data could not be read.");
    }
    this.synergyCache = { matrix, expires: Date.now() + 6 * 60 * 60 * 1000 };
    return matrix;
  }

  async counterMatrix(): Promise<SynergyMatrix> {
    if (this.counterCache && this.counterCache.expires > Date.now()) return this.counterCache.matrix;
    const matrix = await this.pageMatrix("/counters", "counterMatrix");
    this.counterCache = { matrix, expires: Date.now() + 6 * 60 * 60 * 1000 };
    return matrix;
  }

  private async pageMatrix(path: string, variable: string): Promise<SynergyMatrix> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.siteUrl}${path}`, { signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new OverpickerError("Overpicker did not respond. Try again in a moment.");
    }
    if (!response.ok) throw new OverpickerError(`Overpicker returned an error (${response.status}).`);

    const html = await response.text();
    const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(`const ${escapedVariable} = (\\{.*\\});`));
    if (!match?.[1]) throw new OverpickerError("Overpicker's matchup data could not be read.");

    try {
      return JSON.parse(match[1]) as SynergyMatrix;
    } catch {
      throw new OverpickerError("Overpicker's matchup data could not be read.");
    }
  }
}
