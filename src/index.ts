import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type StringSelectMenuInteraction, type UserContextMenuCommandInteraction } from "discord.js";
import { config } from "./config.js";
import { LinkStore } from "./database.js";
import { displayBattletag, OverfastClient, OverfastError } from "./overfast.js";
import type { CompetitiveRank, Gamemode, Platform, StatsSummary } from "./types.js";

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
    else if (interaction.isButton() && interaction.customId.startsWith("ows|")) await changeSummarySection(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith("owm|")) await changeCareerMode(interaction);
    else if (interaction.isButton() && interaction.customId === "ow-score-help") await showScoreHelp(interaction);
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("owh|")) await changeCareerHero(interaction);
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("owb|")) await changeScoreboardMetric(interaction);
  } catch (error) {
    console.error(error);
    const message = error instanceof OverfastError ? error.message : "Something went wrong while running that command.";
    if (interaction.isRepliable()) await (interaction.deferred || interaction.replied ? interaction.editReply(message) : interaction.reply({ content: message, flags: MessageFlags.Ephemeral }));
  }
});

async function handleSlash(i: ChatInputCommandInteraction) {
  const guildId = i.guildId!;
  if (i.commandName === "ow-link") {
    const target = i.options.getUser("user") ?? i.user;
    if (target.bot) {
      await i.reply({ content: "An Overwatch account can't be linked to a bot.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (target.id !== i.user.id && !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({ content: "You need the **Manage Server** permission to link an account for someone else.", flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const playerId = overfast.normalizeBattletag(i.options.getString("battletag", true));
    const platform = i.options.getString("platform", true) as Platform;
    const player = await overfast.summary(playerId);
    store.upsert(guildId, target.id, playerId, displayBattletag(playerId), platform);
    const owner = target.id === i.user.id ? "your Discord account" : `<@${target.id}>`;
    await i.editReply(`Linked **${displayBattletag(playerId)}** (${platform.toUpperCase()}) to ${owner}.`);
  } else if (i.commandName === "ow-unlink") {
    const removed = store.remove(guildId, i.user.id);
    await i.reply({ content: removed ? "Your Overwatch account was unlinked." : "You don't have a linked account.", flags: MessageFlags.Ephemeral });
  } else if (i.commandName === "ow-tag") {
    const user = i.options.getUser("user") ?? i.user;
    const link = store.get(guildId, user.id);
    await i.reply(link ? `<@${user.id}> plays as **${link.battletag}** (${link.platform.toUpperCase()}).` : `<@${user.id}> hasn't linked an Overwatch account yet.`);
  } else if (i.commandName === "ow-profile") {
    await showProfile(i, (i.options.getUser("user") ?? i.user).id, (i.options.getString("mode") ?? "competitive") as Gamemode);
  } else if (i.commandName === "ow-career") {
    await showCareerSummary(i);
  } else if (i.commandName === "ow-hero-career") {
    await showHeroCareer(i);
  } else if (i.commandName === "ow-hero-scoreboard") {
    await showHeroScoreboard(i);
  } else if (i.commandName === "ow-scoreboard") {
    await showScoreboard(i);
  } else if (i.commandName === "ow-comp-check") {
    await checkCompetitiveGroup(i);
  }
}

async function handleAutocomplete(i: AutocompleteInteraction) {
  if (!["ow-hero-career", "ow-hero-scoreboard"].includes(i.commandName) || i.options.getFocused(true).name !== "hero") return;
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

async function showHeroCareer(i: ChatInputCommandInteraction) {
  const user = i.options.getUser("user") ?? i.user;
  const link = store.get(i.guildId!, user.id);
  if (!link) { await i.reply({ content: `<@${user.id}> hasn't linked an Overwatch account yet.`, flags: MessageFlags.Ephemeral }); return; }
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
  await i.editReply(heroCareerView(user.id, link.battletag, link.platform, mode, hero, categories, heroes));
}

async function changeCareerHero(i: StringSelectMenuInteraction) {
  const [, userId, modeValue] = i.customId.split("|");
  const heroKey = i.values[0];
  if (!userId || !heroKey || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That hero selector is no longer valid. Run `/ow-hero-career` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const link = store.get(i.guildId!, userId);
  if (!link) { await i.reply({ content: "That member's Overwatch account is no longer linked.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferUpdate();
  const heroes = await overfast.heroes();
  const hero = heroes.find(candidate => candidate.key === heroKey);
  if (!hero) { await i.editReply({ content: "That hero is no longer available.", embeds: [], components: [] }); return; }
  const categories = (await overfast.career(link.playerId, link.platform, modeValue, hero.key))[hero.key];
  if (!categories || Object.keys(categories).length === 0) {
    await i.editReply({ content: `No ${modeValue} career stats were found for **${hero.name}** on ${link.platform.toUpperCase()}.`, embeds: [], components: heroControls(userId, modeValue, heroes, hero.key) });
    return;
  }
  await i.editReply(heroCareerView(userId, link.battletag, link.platform, modeValue, hero, categories, heroes));
}

async function changeCareerMode(i: ButtonInteraction) {
  const [, userId, heroKey, modeValue] = i.customId.split("|");
  if (!userId || !heroKey || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That mode control is no longer valid. Run `/ow-hero-career` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const link = store.get(i.guildId!, userId);
  if (!link) { await i.reply({ content: "That member's Overwatch account is no longer linked.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferUpdate();
  const heroes = await overfast.heroes();
  const hero = heroes.find(candidate => candidate.key === heroKey);
  if (!hero) { await i.editReply({ content: "That hero is no longer available.", embeds: [], components: [] }); return; }
  const categories = (await overfast.career(link.playerId, link.platform, modeValue, heroKey))[heroKey];
  if (!categories || Object.keys(categories).length === 0) {
    await i.editReply({ content: `No ${modeValue} career stats were found for **${hero.name}** on ${link.platform.toUpperCase()}.`, embeds: [], components: heroControls(userId, modeValue, heroes, heroKey) });
    return;
  }
  await i.editReply(heroCareerView(userId, link.battletag, link.platform, modeValue, hero, categories, heroes));
}

async function showCareerSummary(i: ChatInputCommandInteraction) {
  const user = i.options.getUser("user") ?? i.user;
  const link = store.get(i.guildId!, user.id);
  if (!link) { await i.reply({ content: `<@${user.id}> hasn't linked an Overwatch account yet.`, flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply();
  const mode = (i.options.getString("mode") ?? "competitive") as Gamemode;
  const [profile, stats] = await Promise.all([overfast.summary(link.playerId), overfast.stats(link.playerId, link.platform, mode)]);
  if (!stats.general) { await i.editReply(`No ${mode} career stats were found for this platform.`); return; }
  await i.editReply(summaryView(user.id, link.battletag, link.platform, mode, profile.avatar, stats, "general"));
}

async function changeSummarySection(i: ButtonInteraction) {
  const [, userId, modeValue, section] = i.customId.split("|");
  if (!userId || !section || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That career control is no longer valid. Run `/ow-career` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const link = store.get(i.guildId!, userId);
  if (!link) { await i.reply({ content: "That member's Overwatch account is no longer linked.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferUpdate();
  const [profile, stats] = await Promise.all([overfast.summary(link.playerId), overfast.stats(link.playerId, link.platform, modeValue)]);
  await i.editReply(summaryView(userId, link.battletag, link.platform, modeValue, profile.avatar, stats, section));
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
  const displayedRanked = ranked.slice(0, 15);
  const displayedProvisional = provisional.slice(0, 5);
  const fields = displayedRanked.length
    ? heroScoreFields(displayedRanked)
    : [{ name: "Ranked", value: "*No members have reached the 10-game ranked minimum.*", inline: false }];
  if (displayedProvisional.length) fields.push(
    { name: "Provisional", value: displayedProvisional.map(entry => `• <@${entry.userId}>`).join("\n"), inline: true },
    { name: "Score", value: displayedProvisional.map(entry => `**${entry.score.toFixed(1)}**`).join("\n"), inline: true },
    { name: "Win Rate · Games Played", value: displayedProvisional.map(entry => `${entry.winrate.toFixed(1)}% · ${entry.games}`).join("\n"), inline: true },
  );

  const embed = new EmbedBuilder().setColor(0x405275)
    .setTitle(`${hero.name} Hero Score · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .addFields(fields)
    .setThumbnail(hero.portrait)
    .setFooter({ text: `${titleCase(hero.role)} model · ${unranked} omitted with fewer than 5 games · score is relative to this server` });
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ow-score-help").setLabel("How scoring works").setEmoji("ℹ️").setStyle(ButtonStyle.Secondary),
  );
  await i.editReply({ embeds: [embed], components: [controls] });
}

async function showScoreHelp(i: ButtonInteraction) {
  await i.reply({
    flags: MessageFlags.Ephemeral,
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
function heroScoreFields(entries: HeroScoreEntry[]) {
  return [
    { name: "Player", value: entries.map((entry, index) => `${medal(index)} <@${entry.userId}>`).join("\n"), inline: true },
    { name: "Score", value: entries.map(entry => `**${entry.score.toFixed(1)}**`).join("\n"), inline: true },
    { name: "Win Rate · Games Played", value: entries.map(entry => `${entry.winrate.toFixed(1)}% · ${entry.games}`).join("\n"), inline: true },
  ];
}

async function showProfile(i: ChatInputCommandInteraction | UserContextMenuCommandInteraction, userId: string, mode: Gamemode) {
  const link = store.get(i.guildId!, userId);
  if (!link) { await i.reply({ content: `<@${userId}> hasn't linked an Overwatch account yet.`, flags: MessageFlags.Ephemeral }); return; }
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
  const metric = (i.options.getString("metric") ?? "winrate") as ScoreboardMetric;
  const mode = (i.options.getString("mode") ?? "competitive") as Gamemode;
  await i.editReply(await scoreboardView(i.guildId!, metric, mode));
}

async function changeScoreboardMetric(i: StringSelectMenuInteraction) {
  const [, modeValue] = i.customId.split("|");
  const metric = i.values[0] as ScoreboardMetric | undefined;
  if (!metric || !scoreboardMetrics.includes(metric) || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That scoreboard selector is no longer valid. Run `/ow-scoreboard` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferUpdate();
  await i.editReply(await scoreboardView(i.guildId!, metric, modeValue));
}

type ScoreboardMetric = "winrate" | "kda" | "games_won" | "rank_tank" | "rank_damage" | "rank_support" | "rank_open";
const scoreboardMetrics: ScoreboardMetric[] = ["winrate", "kda", "games_won", "rank_tank", "rank_damage", "rank_support", "rank_open"];

async function scoreboardView(guildId: string, metric: ScoreboardMetric, mode: Gamemode) {
  const links = store.list(guildId);
  if (!links.length) return { content: "Nobody has linked an Overwatch account yet. Use `/ow-link` to join the scoreboard.", embeds: [], components: [] };
  if (metric.startsWith("rank_")) {
    return { content: "", embeds: [await rankScoreboardEmbed(links, metric as RankMetric)], components: scoreboardControls(metric, mode) };
  }
  const statMetric = metric as "winrate" | "kda" | "games_won";
  const rows = (await Promise.all(links.map(async link => {
    try { return { link, stats: (await overfast.stats(link.playerId, link.platform, mode)).general }; }
    catch { return { link, stats: null }; }
  }))).filter((r): r is typeof r & { stats: StatsSummary } => r.stats !== null)
    .sort((a, b) => b.stats[statMetric] - a.stats[statMetric]).slice(0, 15);
  const label = statMetric === "winrate" ? "Win Rate" : statMetric === "kda" ? "KDA" : "Games Won";
  const fields = rows.length ? [
    { name: "Player", value: rows.map((row, index) => `${medal(index)} <@${row.link.discordUserId}>`).join("\n"), inline: true },
    { name: label, value: rows.map(row => `**${formatMetric(statMetric, row.stats[statMetric])}**`).join("\n"), inline: true },
  ] : [];
  const embed = new EmbedBuilder().setColor(0x405275).setTitle(`${label} Scoreboard · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(rows.length ? null : "No public stats were available.").addFields(fields)
    .setFooter({ text: `${rows.length} ranked · platform follows each member's linked setting` });
  return { content: "", embeds: [embed], components: scoreboardControls(metric, mode) };
}

type RankMetric = "rank_tank" | "rank_damage" | "rank_support" | "rank_open";

async function rankScoreboardEmbed(links: ReturnType<LinkStore["list"]>, metric: RankMetric) {
  const role = metric.replace("rank_", "") as "tank" | "damage" | "support" | "open";
  const rows = (await Promise.all(links.map(async link => {
    try {
      const profile = await overfast.summary(link.playerId);
      const rank = profile.competitive?.[link.platform]?.[role];
      return rank ? { link, rank } : null;
    } catch { return null; }
  }))).filter((row): row is { link: (typeof links)[number]; rank: CompetitiveRank } => row !== null)
    .sort((a, b) => rankValue(b.rank) - rankValue(a.rank)).slice(0, 15);
  const roleLabel = role === "open" ? "Open Queue (6v6)" : role === "damage" ? "Damage" : titleCase(role);
  const fields = rows.length ? [
    { name: "Player", value: rows.map((row, index) => `${medal(index)} <@${row.link.discordUserId}>`).join("\n"), inline: true },
    { name: `${roleLabel} Rank`, value: rows.map(row => `**${rankLabel(row.rank)}**`).join("\n"), inline: true },
  ] : [];
  const embed = new EmbedBuilder().setColor(0x405275).setTitle(`${roleLabel} Competitive Rank Scoreboard`)
    .setDescription(rows.length ? null : `No linked members have a current ${roleLabel.toLowerCase()} rank on their linked platform.`)
    .addFields(fields)
    .setFooter({ text: `${rows.length} ranked · current season · platform follows each member's linked setting` });
  return embed;
}

function scoreboardControls(selected: ScoreboardMetric, mode: Gamemode) {
  const labels: Record<ScoreboardMetric, string> = {
    winrate: "Win Rate", kda: "KDA", games_won: "Games Won",
    rank_tank: "Tank Competitive Rank", rank_damage: "Damage Competitive Rank", rank_support: "Support Competitive Rank",
    rank_open: "Open Queue (6v6) Competitive Rank",
  };
  const menu = new StringSelectMenuBuilder().setCustomId(`owb|${mode}`).setPlaceholder("Switch scoreboard type")
    .addOptions(scoreboardMetrics.map(metric => ({ label: labels[metric], value: metric, default: metric === selected })));
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

function rankValue(rank: CompetitiveRank) {
  const divisions = ["bronze", "silver", "gold", "platinum", "diamond", "master", "grandmaster", "champion"];
  const division = divisions.indexOf(rank.division.toLowerCase());
  return Math.max(division, 0) * 5 + (5 - rank.tier);
}
function rankLabel(rank: CompetitiveRank) { return `${titleCase(rank.division)} ${rank.tier}`; }

type CompRole = "tank" | "damage" | "support";
interface CompPlayer { userId: string; platform: Platform; ranks: Partial<Record<CompRole, CompetitiveRank>>; }

async function checkCompetitiveGroup(i: ChatInputCommandInteraction) {
  const users = [1, 2, 3, 4, 5].map(index => i.options.getUser(`player${index}`)).filter((user): user is NonNullable<typeof user> => Boolean(user));
  if (new Set(users.map(user => user.id)).size !== users.length) {
    await i.reply({ content: "Choose each Discord member only once.", flags: MessageFlags.Ephemeral }); return;
  }
  await i.deferReply();
  const linked = users.map(user => ({ user, link: store.get(i.guildId!, user.id) }));
  const missing = linked.filter(item => !item.link).map(item => `<@${item.user.id}>`);
  if (missing.length) { await i.editReply(`${missing.join(", ")} ${missing.length === 1 ? "hasn't" : "haven't"} linked an Overwatch account.`); return; }
  const platforms = new Set(linked.map(item => item.link!.platform));
  if (platforms.size > 1) {
    await i.editReply("This group mixes PC and console accounts. Overwatch Competitive does not support cross-platform groups between those pools."); return;
  }
  const players = (await Promise.all(linked.map(async item => {
    const profile = await overfast.summary(item.link!.playerId);
    const container = profile.competitive?.[item.link!.platform];
    return {
      userId: item.user.id, platform: item.link!.platform,
      ranks: { tank: container?.tank ?? undefined, damage: container?.damage ?? undefined, support: container?.support ?? undefined },
    } satisfies CompPlayer;
  })));
  const combinations = roleCombinations(players).filter(combo => isNarrowCombination(players, combo));
  const embed = new EmbedBuilder().setColor(combinations.length ? 0x57f287 : 0xed4245)
    .setTitle(combinations.length ? "Narrow Competitive Combinations" : "No Confirmed Narrow Combination")
    .setDescription(combinations.length
      ? combinations.slice(0, 20).map((combo, index) => combinationLine(players, combo, index + 1)).join("\n")
      : "No role assignment with published ranks fits the narrow-group range.")
    .setFooter({ text: `${titleCase(players[0]!.platform)} · ${combinations.length} combination${combinations.length === 1 ? "" : "s"} found · displayed ranks only` });
  const unranked = players.filter(player => Object.keys(player.ranks).length === 0);
  if (unranked.length) embed.addFields({ name: "Could not evaluate", value: unranked.map(player => `<@${player.userId}> has no published role ranks.`).join("\n") });
  await i.editReply({ embeds: [embed] });
}

function roleCombinations(players: CompPlayer[]) {
  const results: CompRole[][] = [];
  const walk = (roles: CompRole[]) => {
    if (roles.length === players.length) { results.push(roles); return; }
    for (const role of ["tank", "damage", "support"] as CompRole[]) {
      const limit = role === "tank" ? 1 : 2;
      if (roles.filter(current => current === role).length < limit && players[roles.length]!.ranks[role]) walk([...roles, role]);
    }
  };
  walk([]);
  return results;
}

function isNarrowCombination(players: CompPlayer[], roles: CompRole[]) {
  const ranks = roles.map((role, index) => players[index]!.ranks[role]!);
  return ranks.every((rank, index) => ranks.slice(index + 1).every(other => {
    const distance = Math.abs(rankValue(rank) - rankValue(other));
    return distance <= Math.min(narrowLimit(rank), narrowLimit(other));
  }));
}
function narrowLimit(rank: CompetitiveRank) {
  const division = rank.division.toLowerCase();
  if (division === "champion") return 3;
  if (["master", "grandmaster"].includes(division)) return 5;
  return 10;
}
function combinationLine(players: CompPlayer[], roles: CompRole[], number: number) {
  const assignments = roles.map((role, index) => `${roleEmoji(role)} <@${players[index]!.userId}> (${rankLabel(players[index]!.ranks[role]!)})`);
  return `**${number}.** ${assignments.join(" · ")}`;
}
function roleEmoji(role: CompRole) { return role === "tank" ? "🛡️" : role === "damage" ? "⚔️" : "💚"; }

function statFields(s: StatsSummary) { return [
  { name: "Win Rate", value: `${s.winrate.toFixed(1)}%`, inline: true },
  { name: "Record", value: `${s.games_won}W – ${s.games_lost}L`, inline: true },
  { name: "KDA", value: s.kda.toFixed(2), inline: true },
  { name: "Elims / 10", value: s.average.eliminations.toFixed(1), inline: true },
  { name: "Damage / 10", value: Math.round(s.average.damage).toLocaleString(), inline: true },
  { name: "Healing / 10", value: Math.round(s.average.healing).toLocaleString(), inline: true },
]; }
function formatMetric(metric: string, value: number) { return metric === "winrate" ? `${value.toFixed(1)}%` : metric === "kda" ? value.toFixed(2) : String(value); }
function medal(index: number) { return ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`; }
function heroCareerView(
  userId: string,
  battletag: string,
  platform: Platform,
  mode: Gamemode,
  hero: { key: string; name: string; portrait: string | null },
  categories: Record<string, Record<string, string | number>>,
  heroes: Array<{ key: string; name: string; role: string }>,
) {
  const embed = new EmbedBuilder().setColor(0xf99e1a)
    .setTitle(`${hero.name} Career · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(`<@${userId}> · **${battletag}** · ${platform.toUpperCase()}`)
    .setThumbnail(hero.portrait)
    .addFields(heroCareerFields(categories))
    .setFooter({ text: "Average is per 10 minutes · Stats supplied by OverFast API" });
  return { content: "", embeds: [embed], components: heroControls(userId, mode, heroes, hero.key) };
}

function heroControls(userId: string, mode: Gamemode, heroes: Array<{ key: string; name: string; role: string }>, selected: string) {
  const modeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`owm|${userId}|${selected}|competitive`).setLabel("Competitive")
      .setStyle(mode === "competitive" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(mode === "competitive"),
    new ButtonBuilder().setCustomId(`owm|${userId}|${selected}|quickplay`).setLabel("Quick Play")
      .setStyle(mode === "quickplay" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(mode === "quickplay"),
  );
  return [modeRow, ...heroSelectorRows(userId, mode, heroes, selected)];
}

function heroSelectorRows(userId: string, mode: Gamemode, heroes: Array<{ key: string; name: string; role: string }>, selected: string) {
  return ["tank", "damage", "support"].flatMap(role => {
    const options = heroes.filter(hero => hero.role === role).slice(0, 25);
    if (!options.length) return [];
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`owh|${userId}|${mode}|${role}`)
      .setPlaceholder(`Switch ${titleCase(role)} hero`)
      .addOptions(options.map(hero => ({ label: hero.name, value: hero.key, default: hero.key === selected })));
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  });
}

function heroCareerFields(categories: Record<string, Record<string, string | number>>) {
  const grouped = new Map<string, { average?: string; best?: string; total?: string }>();
  const ignored = new Set(["games_played", "games_won", "games_lost", "hero_wins", "win_percentage", "time_played"]);
  for (const [category, stats] of Object.entries(categories)) {
    for (const [key, value] of Object.entries(stats)) {
      if (ignored.has(key)) continue;
      let base = key;
      let kind: "average" | "best" | "total" = "total";
      if (key.endsWith("_avg_per_10_min")) { base = key.replace(/_avg_per_10_min$/, ""); kind = "average"; }
      else if (key.endsWith("_most_in_game")) { base = key.replace(/_most_in_game$/, ""); kind = "best"; }
      else if (category === "average") kind = "average";
      else if (category === "best") kind = "best";
      const group = grouped.get(base) ?? {};
      group[kind] = statValue(key, value);
      grouped.set(base, group);
    }
  }
  const game = categories.game ?? {};
  const games = numeric(game.games_played);
  const timePlayed = numeric(game.time_played);
  const overview = games === 0 && timePlayed > 0
    ? `**Partial activity:** ${formatDuration(timePlayed)} recorded\nNo completed games were reported by Blizzard.`
    : `**Games:** ${games.toLocaleString()}\n**Record:** ${numeric(game.games_won)}W – ${numeric(game.games_lost)}L\n**Win Rate:** ${numeric(game.win_percentage)}%\n**Time Played:** ${formatDuration(timePlayed)}`;
  const fields = [{
    name: "Overview",
    value: overview,
    inline: true,
  }];
  for (const [key, values] of grouped) {
    const lines = [values.average && `**Average:** ${values.average}`, values.best && `**Best:** ${values.best}`, values.total && `**Total:** ${values.total}`].filter(Boolean);
    if (lines.length >= 2) fields.push({ name: statLabel(key), value: lines.join("\n"), inline: true });
  }
  return fields.slice(0, 25);
}

function summaryView(userId: string, battletag: string, platform: Platform, mode: Gamemode, avatar: string | null, stats: import("./types.js").PlayerStatsSummary, selected: string) {
  const available: Array<[string, StatsSummary | null | undefined]> = [["general", stats.general], ["tank", stats.roles?.tank], ["damage", stats.roles?.damage], ["support", stats.roles?.support]];
  const current = available.find(([key]) => key === selected)?.[1] ?? stats.general;
  const embed = new EmbedBuilder().setColor(0xf99e1a)
    .setTitle(`${titleCase(selected)} Career · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(`<@${userId}> · **${battletag}** · ${platform.toUpperCase()}`)
    .setThumbnail(avatar)
    .setFooter({ text: "Averages are per 10 minutes · Stats supplied by OverFast API" });
  if (current) embed.addFields(summaryFields(current));
  else embed.addFields({ name: "No stats", value: `No ${selected} stats were found.`, inline: false });
  const buttons = available.filter(([, value]) => value).map(([key]) => new ButtonBuilder()
    .setCustomId(`ows|${userId}|${mode}|${key}`).setLabel(titleCase(key))
    .setStyle(key === selected ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(key === selected));
  return { content: "", embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] };
}

function summaryFields(s: StatsSummary) {
  return [
    { name: "Overview", value: `**Games:** ${s.games_played.toLocaleString()}\n**Record:** ${s.games_won}W – ${s.games_lost}L\n**Win Rate:** ${s.winrate.toFixed(1)}%\n**Time Played:** ${formatDuration(s.time_played)}\n**KDA:** ${s.kda.toFixed(2)}`, inline: true },
    { name: "Eliminations", value: `**Average:** ${s.average.eliminations.toFixed(1)}\n**Total:** ${s.total?.eliminations?.toLocaleString() ?? "—"}`, inline: true },
    { name: "Assists", value: `**Average:** ${s.average.assists.toFixed(1)}\n**Total:** ${s.total?.assists?.toLocaleString() ?? "—"}`, inline: true },
    { name: "Deaths", value: `**Average:** ${s.average.deaths.toFixed(1)}\n**Total:** ${s.total?.deaths?.toLocaleString() ?? "—"}`, inline: true },
    { name: "Damage", value: `**Average:** ${Math.round(s.average.damage).toLocaleString()}\n**Total:** ${s.total?.damage?.toLocaleString() ?? "—"}`, inline: true },
    { name: "Healing", value: `**Average:** ${Math.round(s.average.healing).toLocaleString()}\n**Total:** ${s.total?.healing?.toLocaleString() ?? "—"}`, inline: true },
  ];
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
