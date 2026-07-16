import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, PermissionFlagsBits, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type UserContextMenuCommandInteraction } from "discord.js";
import { config } from "./config.js";
import { LinkStore } from "./database.js";
import { displayBattletag, OverfastClient, OverfastError } from "./overfast.js";
import type { Gamemode, Platform, StatsSummary } from "./types.js";

const store = new LinkStore(config.databasePath);
const overfast = new OverfastClient(config.overfastBaseUrl);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, ready => console.log(`Ready as ${ready.user.tag}`));
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.inGuild()) return;
  try {
    if (interaction.isAutocomplete()) await handleAutocomplete(interaction);
    else if (interaction.isChatInputCommand()) await handleSlash(interaction);
    else if (interaction.isUserContextMenuCommand()) await showProfile(interaction, interaction.targetId, "competitive");
    else if (interaction.isButton() && interaction.customId.startsWith("owc|")) await changeCareerSection(interaction);
    else if (interaction.isButton() && interaction.customId === "ow-score-help") await showScoreHelp(interaction);
  } catch (error) {
    console.error(error);
    const message = error instanceof OverfastError ? error.message : "Something went wrong while running that command.";
    if (interaction.isRepliable()) await (interaction.deferred || interaction.replied ? interaction.editReply(message) : interaction.reply({ content: message, ephemeral: true }));
  }
});

async function handleSlash(i: ChatInputCommandInteraction) {
  const guildId = i.guildId!;
  if (i.commandName === "ow-link") {
    const target = i.options.getUser("user") ?? i.user;
    if (target.bot) {
      await i.reply({ content: "An Overwatch account can't be linked to a bot.", ephemeral: true });
      return;
    }
    if (target.id !== i.user.id && !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({ content: "You need the **Manage Server** permission to link an account for someone else.", ephemeral: true });
      return;
    }
    await i.deferReply({ ephemeral: true });
    const playerId = overfast.normalizeBattletag(i.options.getString("battletag", true));
    const platform = i.options.getString("platform", true) as Platform;
    const player = await overfast.summary(playerId);
    store.upsert(guildId, target.id, playerId, displayBattletag(playerId), platform);
    const owner = target.id === i.user.id ? "your Discord account" : `<@${target.id}>`;
    await i.editReply(`Linked **${displayBattletag(playerId)}** (${platform.toUpperCase()}) to ${owner}.`);
  } else if (i.commandName === "ow-unlink") {
    const removed = store.remove(guildId, i.user.id);
    await i.reply({ content: removed ? "Your Overwatch account was unlinked." : "You don't have a linked account.", ephemeral: true });
  } else if (i.commandName === "ow-tag") {
    const user = i.options.getUser("user") ?? i.user;
    const link = store.get(guildId, user.id);
    await i.reply(link ? `<@${user.id}> plays as **${link.battletag}** (${link.platform.toUpperCase()}).` : `<@${user.id}> hasn't linked an Overwatch account yet.`);
  } else if (i.commandName === "ow-profile") {
    await showProfile(i, (i.options.getUser("user") ?? i.user).id, (i.options.getString("mode") ?? "competitive") as Gamemode);
  } else if (i.commandName === "ow-career") {
    await showCareer(i);
  } else if (i.commandName === "ow-hero-scoreboard") {
    await showHeroScoreboard(i);
  } else if (i.commandName === "ow-scoreboard") {
    await showScoreboard(i);
  }
}

async function handleAutocomplete(i: AutocompleteInteraction) {
  if (!["ow-career", "ow-hero-scoreboard"].includes(i.commandName) || i.options.getFocused(true).name !== "hero") return;
  const query = i.options.getFocused().toLowerCase();
  try {
    const heroes = (await overfast.heroes())
      .filter(hero => hero.name.toLowerCase().includes(query) || hero.key.includes(query))
      .slice(0, 25)
      .map(hero => ({ name: `${hero.name} · ${titleCase(hero.role)}`, value: hero.key }));
    await i.respond(heroes);
  } catch {
    await i.respond([]);
  }
}

async function showCareer(i: ChatInputCommandInteraction) {
  const user = i.options.getUser("user") ?? i.user;
  const link = store.get(i.guildId!, user.id);
  if (!link) { await i.reply({ content: `<@${user.id}> hasn't linked an Overwatch account yet.`, ephemeral: true }); return; }
  await i.deferReply();
  const heroKey = i.options.getString("hero", true);
  const mode = (i.options.getString("mode") ?? "competitive") as Gamemode;
  const heroes = await overfast.heroes();
  const hero = heroes.find(candidate => candidate.key === heroKey);
  if (!hero) { await i.editReply("Choose a hero from the autocomplete list."); return; }
  const career = await overfast.career(link.playerId, link.platform, mode, hero.key);
  const categories = career[hero.key];
  if (!categories || Object.keys(categories).length === 0) {
    await i.editReply(`No ${mode} career stats were found for **${hero.name}** on ${link.platform.toUpperCase()}.`);
    return;
  }
  const selected = preferredCareerCategory(Object.keys(categories));
  await i.editReply(careerView(user.id, link.battletag, link.platform, mode, hero, categories, selected));
}

async function changeCareerSection(i: ButtonInteraction) {
  const [, userId, heroKey, modeValue, category] = i.customId.split("|");
  if (!userId || !heroKey || !category || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That career control is no longer valid. Run `/ow-career` again.", ephemeral: true });
    return;
  }
  const link = store.get(i.guildId!, userId);
  if (!link) { await i.reply({ content: "That member's Overwatch account is no longer linked.", ephemeral: true }); return; }
  await i.deferUpdate();
  const heroes = await overfast.heroes();
  const hero = heroes.find(candidate => candidate.key === heroKey);
  if (!hero) { await i.editReply({ content: "That hero is no longer available.", embeds: [], components: [] }); return; }
  const career = await overfast.career(link.playerId, link.platform, modeValue, heroKey);
  const categories = career[heroKey];
  if (!categories?.[category]) {
    await i.editReply({ content: "That career section is no longer available.", embeds: [], components: [] });
    return;
  }
  await i.editReply(careerView(userId, link.battletag, link.platform, modeValue, hero, categories, category));
}

interface HeroScoreEntry {
  userId: string;
  games: number;
  wins: number;
  winrate: number;
  adjustedWinrate: number;
  metrics: Record<string, number>;
  deaths: number;
  performance: number;
  survivability: number;
  experience: number;
  score: number;
}

async function showHeroScoreboard(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const heroKey = i.options.getString("hero", true);
  const mode = (i.options.getString("mode") ?? "competitive") as Gamemode;
  const hero = (await overfast.heroes()).find(candidate => candidate.key === heroKey);
  if (!hero) { await i.editReply("Choose a hero from the autocomplete list."); return; }
  const links = store.list(i.guildId!);
  if (!links.length) { await i.editReply("Nobody has linked an Overwatch account yet."); return; }

  const entries = (await Promise.all(links.map(async link => {
    try {
      const career = await overfast.career(link.playerId, link.platform, mode, hero.key);
      return careerEntry(link.discordUserId, career[hero.key]);
    } catch { return null; }
  }))).filter((entry): entry is HeroScoreEntry => entry !== null);
  if (!entries.length) {
    await i.editReply(`No linked members have public ${mode} stats for **${hero.name}**.`);
    return;
  }

  scoreHeroEntries(entries, hero.role);
  const ranked = entries.filter(entry => entry.games >= 10).sort((a, b) => b.score - a.score);
  const provisional = entries.filter(entry => entry.games >= 5 && entry.games < 10).sort((a, b) => b.score - a.score);
  const unranked = entries.filter(entry => entry.games < 5).length;
  const lines = ranked.slice(0, 15).map((entry, index) => scoreLine(entry, medal(index)));
  if (provisional.length) {
    lines.push("\n**Provisional (5–9 games)**", ...provisional.slice(0, 5).map(entry => scoreLine(entry, "•")));
  }
  if (!ranked.length) lines.unshift("*No members have reached the 10-game ranked minimum.*");

  const embed = new EmbedBuilder().setColor(0x405275)
    .setTitle(`${hero.name} Hero Score · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(lines.join("\n"))
    .setThumbnail(hero.portrait)
    .setFooter({ text: `${titleCase(hero.role)} model · ${unranked} omitted with fewer than 5 games · score is relative to this server` });
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ow-score-help").setLabel("How scoring works").setEmoji("ℹ️").setStyle(ButtonStyle.Secondary),
  );
  await i.editReply({ embeds: [embed], components: [controls] });
}

async function showScoreHelp(i: ButtonInteraction) {
  await i.reply({
    ephemeral: true,
    content: [
      "**Hero Score (0–100)**",
      "• **40% adjusted win rate** — win rate is pulled toward the server average when the sample is small.",
      "• **25% role performance** — Tank: eliminations, assists, damage, objective time. Damage: eliminations, damage, final blows, assists. Support: healing, assists, eliminations, damage.",
      "• **20% survivability** — fewer deaths per 10 minutes scores higher.",
      "• **15% experience** — confidence rises with games played but has diminishing returns.",
      "Metrics are normalized against linked server members on the same hero. At least 10 games are required to rank; 5–9 is provisional.",
    ].join("\n"),
  });
}

function careerEntry(userId: string, categories: Record<string, Record<string, string | number>> | undefined): HeroScoreEntry | null {
  if (!categories) return null;
  const game = categories.game ?? {};
  const average = categories.average ?? {};
  const games = numeric(game.games_played);
  if (games <= 0) return null;
  const wins = numeric(game.games_won || game.hero_wins);
  return {
    userId, games, wins, winrate: numeric(game.win_percentage) || wins / games * 100,
    adjustedWinrate: 0,
    metrics: {
      eliminations: numeric(average.eliminations_avg_per_10_min),
      assists: numeric(average.assists_avg_per_10_min),
      damage: numeric(average.hero_damage_done_avg_per_10_min || average.all_damage_done_avg_per_10_min),
      healing: numeric(average.healing_done_avg_per_10_min),
      finalBlows: numeric(average.final_blows_avg_per_10_min),
      objectiveTime: numeric(average.objective_time_avg_per_10_min || average.obj_contest_time_avg_per_10_min),
    },
    deaths: numeric(average.deaths_avg_per_10_min),
    performance: 0, survivability: 0, experience: 0, score: 0,
  };
}

function scoreHeroEntries(entries: HeroScoreEntry[], role: string) {
  const totalGames = entries.reduce((sum, entry) => sum + entry.games, 0);
  const totalWins = entries.reduce((sum, entry) => sum + entry.wins, 0);
  const serverWinrate = totalGames ? totalWins / totalGames * 100 : 50;
  const weights = roleMetricWeights(role);
  for (const entry of entries) {
    entry.adjustedWinrate = (entry.wins + 10 * serverWinrate / 100) / (entry.games + 10) * 100;
    entry.performance = Object.entries(weights).reduce((sum, [metric, weight]) =>
      sum + normalized(entry.metrics[metric] ?? 0, entries.map(item => item.metrics[metric] ?? 0)) * weight, 0);
    entry.survivability = entry.deaths > 0
      ? 100 - normalized(entry.deaths, entries.filter(item => item.deaths > 0).map(item => item.deaths))
      : 0;
    entry.experience = (1 - Math.exp(-entry.games / 20)) * 100;
    entry.score = 0.40 * entry.adjustedWinrate + 0.25 * entry.performance + 0.20 * entry.survivability + 0.15 * entry.experience;
  }
}

function roleMetricWeights(role: string): Record<string, number> {
  if (role === "support") return { healing: .35, assists: .30, eliminations: .20, damage: .15 };
  if (role === "tank") return { eliminations: .40, assists: .25, damage: .25, objectiveTime: .10 };
  return { eliminations: .45, damage: .30, finalBlows: .15, assists: .10 };
}

function normalized(value: number, values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min ? 50 : (value - min) / (max - min) * 100;
}
function numeric(value: string | number | undefined) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function scoreLine(entry: HeroScoreEntry, prefix: string) {
  return `${prefix} <@${entry.userId}> — **${entry.score.toFixed(1)}** · ${entry.winrate.toFixed(1)}% WR · ${entry.games} games`;
}

async function showProfile(i: ChatInputCommandInteraction | UserContextMenuCommandInteraction, userId: string, mode: Gamemode) {
  const link = store.get(i.guildId!, userId);
  if (!link) { await i.reply({ content: `<@${userId}> hasn't linked an Overwatch account yet.`, ephemeral: true }); return; }
  await i.deferReply();
  const [profile, stats] = await Promise.all([overfast.summary(link.playerId), overfast.stats(link.playerId, link.platform, mode)]);
  const s = stats.general;
  const embed = new EmbedBuilder().setColor(0xf99e1a).setTitle(`${profile.username} — ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(`**BattleTag:** ${link.battletag} · **Platform:** ${link.platform.toUpperCase()}`)
    .setThumbnail(profile.avatar).setFooter({ text: "Stats supplied by OverFast API · profiles must be public" });
  if (s) embed.addFields(statFields(s)); else embed.addFields({ name: "No stats", value: `No ${mode} stats were found for this platform.` });
  await i.editReply({ embeds: [embed] });
}

async function showScoreboard(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const metric = (i.options.getString("metric") ?? "winrate") as "winrate" | "kda" | "games_won";
  const mode = (i.options.getString("mode") ?? "competitive") as Gamemode;
  const links = store.list(i.guildId!);
  if (!links.length) { await i.editReply("Nobody has linked an Overwatch account yet. Use `/ow-link` to join the scoreboard."); return; }
  const rows = (await Promise.all(links.map(async link => {
    try { return { link, stats: (await overfast.stats(link.playerId, link.platform, mode)).general }; }
    catch { return { link, stats: null }; }
  }))).filter((r): r is typeof r & { stats: StatsSummary } => r.stats !== null)
    .sort((a, b) => b.stats[metric] - a.stats[metric]).slice(0, 15);
  const label = metric === "winrate" ? "Win Rate" : metric === "kda" ? "KDA" : "Games Won";
  const lines = rows.map((r, n) => `${medal(n)} <@${r.link.discordUserId}> — **${formatMetric(metric, r.stats[metric])}**`);
  const embed = new EmbedBuilder().setColor(0x405275).setTitle(`${label} Scoreboard · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(lines.join("\n") || "No public stats were available.").setFooter({ text: `${rows.length} ranked · platform follows each member's linked setting` });
  await i.editReply({ embeds: [embed] });
}

function statFields(s: StatsSummary) { return [
  { name: "Win Rate", value: `${s.winrate.toFixed(1)}%`, inline: true },
  { name: "Record", value: `${s.games_won}W – ${s.games_lost}L`, inline: true },
  { name: "KDA", value: s.kda.toFixed(2), inline: true },
  { name: "Elims / 10", value: s.average.eliminations.toFixed(1), inline: true },
  { name: "Damage / 10", value: Math.round(s.average.damage).toLocaleString(), inline: true },
  { name: "Healing / 10", value: Math.round(s.average.healing).toLocaleString(), inline: true },
]; }
function medal(index: number) { return ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`; }
function formatMetric(metric: string, value: number) { return metric === "winrate" ? `${value.toFixed(1)}%` : metric === "kda" ? value.toFixed(2) : String(value); }
function careerView(
  userId: string,
  battletag: string,
  platform: Platform,
  mode: Gamemode,
  hero: { key: string; name: string; portrait: string | null },
  categories: Record<string, Record<string, string | number>>,
  selected: string,
) {
  const embed = new EmbedBuilder().setColor(0xf99e1a)
    .setTitle(`${hero.name} Career · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(`<@${userId}> · **${battletag}** · ${platform.toUpperCase()}`)
    .setThumbnail(hero.portrait)
    .addFields(careerFields(selected, categories[selected]!))
    .setFooter({ text: `${titleCase(selected.replace(/_/g, " "))} · Stats supplied by OverFast API` });
  const buttons = Object.keys(categories).map(category => new ButtonBuilder()
    .setCustomId(`owc|${userId}|${hero.key}|${mode}|${category}`)
    .setLabel(careerCategoryLabel(category))
    .setStyle(category === selected ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(category === selected));
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  }
  return { content: "", embeds: [embed], components };
}
function preferredCareerCategory(categories: string[]) {
  return categories.includes("game") ? "game" : categories[0]!;
}
function careerCategoryLabel(category: string) {
  const labels: Record<string, string> = { hero_specific: "Hero Specific", match_awards: "Awards" };
  return labels[category] ?? titleCase(category.replace(/_/g, " "));
}
function careerFields(category: string, stats: Record<string, string | number>) {
  const rows = Object.entries(stats).map(([key, value]) => ({
    label: statLabel(key),
    value: statValue(key, value),
  }));
  const labelWidth = Math.min(32, Math.max("Statistic".length, ...rows.map(row => row.label.length)));
  const valueWidth = Math.min(18, Math.max("Value".length, ...rows.map(row => row.value.length)));
  const header = `${"Statistic".padEnd(labelWidth)}  ${"Value".padStart(valueWidth)}`;
  const divider = `${"─".repeat(labelWidth)}  ${"─".repeat(valueWidth)}`;
  const lines = rows.map(row => `${truncate(row.label, labelWidth).padEnd(labelWidth)}  ${truncate(row.value, valueWidth).padStart(valueWidth)}`);
  const chunks: string[] = [];
  let chunk = `${header}\n${divider}`;
  for (const line of lines) {
    if (chunk.length + line.length + 1 > 990) {
      chunks.push(`\`\`\`\n${chunk}\n\`\`\``);
      chunk = `${header}\n${divider}`;
    }
    chunk += `\n${line}`;
  }
  if (chunk) chunks.push(`\`\`\`\n${chunk}\n\`\`\``);
  return chunks.map((value, index) => ({ name: `${careerCategoryLabel(category)}${index ? ` (${index + 1})` : ""}`, value, inline: false }));
}
function truncate(value: string, width: number) {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}
function statLabel(key: string) {
  return titleCase(key.replace(/_avg_per_10_min$/, " / 10 min").replace(/_most_in_game$/, " (best game)").replace(/_/g, " "));
}
function statValue(key: string, value: string | number) {
  if (typeof value !== "number") return value;
  if (key.includes("time") && !key.includes("avg_per_10_min")) return formatDuration(value);
  if (key.includes("accuracy") || key.includes("percentage")) return `${value}%`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.round(seconds % 60);
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}
function titleCase(value: string) { return value.replace(/\b\w/g, letter => letter.toUpperCase()); }

await client.login(config.token());
