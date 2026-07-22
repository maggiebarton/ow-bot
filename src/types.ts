export type Platform = "pc" | "console";
export type Gamemode = "competitive" | "quickplay";

export interface PlayerSummary {
  username: string;
  avatar: string | null;
  namecard?: string | null;
  title?: string | null;
  endorsement?: { level: number } | null;
  competitive?: Partial<Record<Platform, CompetitiveRanks | null>>;
}

export interface CompetitiveRank {
  division: string;
  tier: number;
  role_icon?: string;
  rank_icon?: string;
  tier_icon?: string;
}

export interface CompetitiveRanks {
  season: number;
  tank: CompetitiveRank | null;
  damage: CompetitiveRank | null;
  support: CompetitiveRank | null;
  open?: CompetitiveRank | null;
}

export interface StatsSummary {
  games_played: number;
  games_won: number;
  games_lost: number;
  winrate: number;
  kda: number;
  time_played: number;
  average: {
    eliminations: number;
    assists: number;
    deaths: number;
    damage: number;
    healing: number;
  };
  total?: {
    eliminations: number;
    assists: number;
    deaths: number;
    damage: number;
    healing: number;
  };
}

export interface PlayerStatsSummary {
  general: StatsSummary | null;
  roles: Record<string, StatsSummary | null> | null;
  heroes: Record<string, StatsSummary | null> | null;
}

export interface Hero {
  key: string;
  name: string;
  portrait: string | null;
  role: string;
}

export type CareerStats = Record<string, Record<string, Record<string, string | number>>>;

export interface LinkRecord {
  accountId: number;
  guildId: string;
  discordUserId: string;
  label: string;
  isDefault: boolean;
  playerId: string;
  battletag: string;
  platform: Platform;
  linkedAt: string;
}
