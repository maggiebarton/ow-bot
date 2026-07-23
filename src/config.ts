import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  token: () => required("DISCORD_TOKEN"),
  clientId: () => required("DISCORD_CLIENT_ID"),
  guildId: process.env.DISCORD_GUILD_ID,
  databasePath: process.env.DATABASE_PATH ?? "./data/ow-bot.db",
  overfastBaseUrl: process.env.OVERFAST_BASE_URL ?? "https://overfast-api.tekrop.fr",
  overpickerBaseUrl: process.env.OVERPICKER_BASE_URL ?? "https://api.overpicker.com",
};
