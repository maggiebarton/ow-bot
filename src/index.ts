import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type StringSelectMenuInteraction, type UserContextMenuCommandInteraction } from "discord.js";
import { config } from "./config.js";
import { LinkStore } from "./database.js";
import { displayBattletag, OverfastClient, OverfastError } from "./overfast.js";
import type { CompetitiveRank, Gamemode, LinkRecord, Platform, StatsSummary } from "./types.js";

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
    else if (interaction.isButton() && interaction.customId.startsWith("ow-meme|")) await changeMeme(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith("ow-random-hero|")) await rerollHero(interaction);
    else if (interaction.isButton() && interaction.customId === "ow-score-help") await showScoreHelp(interaction);
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("owh|")) await changeCareerHero(interaction);
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("owb|")) await changeScoreboardMetric(interaction);
  } catch (error) {
    console.error(error);
    const detail = error instanceof OverfastError || (error instanceof Error && error.message.startsWith("Account labels"))
      ? error.message : "Something went wrong while running that command.";
    const message = `⚠️ **Couldn't finish that**\n${detail}`;
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
    const label = i.options.getString("account") ?? "main";
    await overfast.summary(playerId);
    const link = store.upsert(guildId, target.id, label, playerId, displayBattletag(playerId), platform, i.options.getBoolean("default") ?? false);
    const owner = target.id === i.user.id ? "your Discord account" : `<@${target.id}>`;
    await i.editReply(["✅ **Account linked**", `**${link.battletag}** · ${platform.toUpperCase()}`, `${owner} · \`${link.label}\`${link.isDefault ? " · ⭐ Default" : ""}`, "", "Try `/ow-profile` to see the headline stats."].join("\n"));
  } else if (i.commandName === "ow-unlink") {
    const label = i.options.getString("account") ?? undefined;
    const removed = store.remove(guildId, i.user.id, label);
    await i.reply({ content: removed ? `✅ **Account unlinked**\n**${removed.battletag}** · \`${removed.label}\`` : label ? `⚠️ **Account not found**\nYou don't have an account labeled \`${label}\`.` : "⚠️ **No linked account**\nUse `/ow-link` to add one.", flags: MessageFlags.Ephemeral });
  } else if (i.commandName === "ow-tag") {
    const user = i.options.getUser("user") ?? i.user;
    const label = i.options.getString("account");
    const links = label ? [store.get(guildId, user.id, label)].filter(link => link !== undefined) : store.list(guildId, user.id);
    await i.reply(links.length ? [`**Linked accounts · <@${user.id}>**`, ...links.map(link => `${link.isDefault ? "⭐" : "•"} **${link.battletag}** · ${link.platform.toUpperCase()}\n　\`${link.label}\`${link.isDefault ? " · Default" : ""}`)].join("\n") : missingAccountMessage(user.id, label ?? undefined));
  } else if (i.commandName === "ow-profile") {
    await showProfile(i, (i.options.getUser("user") ?? i.user).id, (i.options.getString("mode") ?? "competitive") as Gamemode, i.options.getString("account") ?? undefined);
  } else if (i.commandName === "ow-career") {
    await showCareerSummary(i);
  } else if (i.commandName === "ow-hero-career") {
    await showHeroCareer(i);
  } else if (i.commandName === "ow-hero-scoreboard") {
    await showHeroScoreboard(i);
  } else if (i.commandName === "ow-scoreboard") {
    await showScoreboard(i);
  } else if (i.commandName === "ow-meme") {
    await showMeme(i);
  } else if (i.commandName === "ow-random-hero") {
    await showRandomHero(i);
  } else if (i.commandName === "ow-comp-check") {
    await checkCompetitiveGroup(i);
  }
}

type HeroRoleFilter = "all" | "tank" | "damage" | "support";

async function showRandomHero(i: ChatInputCommandInteraction) {
  const role = (i.options.getString("role") ?? "all") as HeroRoleFilter;
  await i.deferReply();
  await i.editReply(await randomHeroView(role));
}

async function rerollHero(i: ButtonInteraction) {
  const [, roleValue, previousHero] = i.customId.split("|");
  if (!isHeroRoleFilter(roleValue)) {
    await i.reply({ content: "⚠️ **That hero picker expired**\nRun `/ow-random-hero` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferUpdate();
  await i.editReply(await randomHeroView(roleValue, previousHero));
}

async function randomHeroView(role: HeroRoleFilter, exclude?: string) {
  const eligible = (await overfast.heroes()).filter(hero => role === "all" || hero.role === role);
  if (!eligible.length) return { content: "⚠️ **No heroes found for that role**", embeds: [], components: [] };
  const pool = eligible.length > 1 ? eligible.filter(hero => hero.key !== exclude) : eligible;
  const hero = pool[Math.floor(Math.random() * pool.length)]!;
  const roleLabel = titleCase(hero.role);
  const embed = new EmbedBuilder()
    .setColor(0xf99e1a)
    .setTitle(`🎲 You should play ${hero.name}`)
    .setDescription(`**${roleEmoji(hero.role as CompRole)} ${roleLabel}**\n*No counter-picking. The bot has spoken.*`)
    .setThumbnail(hero.portrait)
    .setFooter({ text: role === "all" ? "Picking from all roles" : `Picking from ${roleLabel} heroes` });
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ow-random-hero|${role}|${hero.key}`).setLabel("Reroll").setEmoji("🎲").setStyle(ButtonStyle.Primary),
  );
  return { content: "", embeds: [embed], components: [controls] };
}

function isHeroRoleFilter(value: string | undefined): value is HeroRoleFilter {
  return value === "all" || value === "tank" || value === "damage" || value === "support";
}

const memeDirectory = fileURLToPath(new URL("../assets/memes/", import.meta.url));
const memeExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);

async function showMeme(i: ChatInputCommandInteraction) {
  const files = memeFiles();
  if (!files.length) {
    await i.reply({ content: "⚠️ **The meme vault is empty**\nAdd an image to `assets/memes` and try again.", flags: MessageFlags.Ephemeral });
    return;
  }
  await i.reply(memeView(files, randomMemeIndex(files.length)));
}

async function changeMeme(i: ButtonInteraction) {
  const previous = Number(i.customId.split("|")[1]);
  const files = memeFiles();
  if (!files.length) {
    await i.update({ content: "⚠️ **The meme vault is empty**", embeds: [], components: [], attachments: [] });
    return;
  }
  await i.deferUpdate();
  await i.editReply({ ...memeView(files, randomMemeIndex(files.length, previous)), attachments: [] });
}

function memeFiles() {
  return readdirSync(memeDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && memeExtensions.has(extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function randomMemeIndex(count: number, exclude = -1) {
  if (count < 2) return 0;
  let index = Math.floor(Math.random() * count);
  while (index === exclude) index = Math.floor(Math.random() * count);
  return index;
}

function memeView(files: string[], index: number) {
  const sourceName = files[index]!;
  const filename = `oversauce-meme-${index + 1}${extname(sourceName).toLowerCase()}`;
  const path = join(memeDirectory, sourceName);
  const embed = new EmbedBuilder()
    .setColor(0xf99e1a)
    .setTitle("😂 Overwatch meme break")
    .setDescription("*Fresh from the OverSauce meme vault.*")
    .setImage(`attachment://${filename}`)
    .setFooter({ text: `${index + 1} of ${files.length}` });
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ow-meme|${index}`).setLabel("Another one").setEmoji("🎲").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [controls], files: [new AttachmentBuilder(path, { name: filename })] };
}

async function handleAutocomplete(i: AutocompleteInteraction) {
  const focused = i.options.getFocused(true);
  const accountMatch = i.commandName === "ow-comp-check" ? focused.name.match(/^account([1-5])$/) : null;
  if (accountMatch) {
    const user = i.options.get(`player${accountMatch[1]}`)?.user;
    const query = String(focused.value).toLowerCase();
    const accounts = user ? store.list(i.guildId!, user.id)
      .filter(link => link.label.includes(query) || link.battletag.toLowerCase().includes(query))
      .slice(0, 25)
      .map(link => ({ name: `${link.label}${link.isDefault ? " (default)" : ""} · ${link.battletag}`, value: link.label })) : [];
    await i.respond(accounts);
    return;
  }
  if (focused.name === "account") {
    const user = i.commandName === "ow-unlink" ? i.user : i.options.get("user")?.user ?? i.user;
    const query = String(focused.value).toLowerCase();
    await i.respond(store.list(i.guildId!, user.id)
      .filter(link => link.label.includes(query) || link.battletag.toLowerCase().includes(query))
      .slice(0, 25)
      .map(link => ({ name: `${link.isDefault ? "★ " : ""}${link.label} · ${link.battletag} · ${link.platform.toUpperCase()}`, value: link.label })));
    return;
  }
  if (!["ow-hero-career", "ow-hero-scoreboard"].includes(i.commandName) || focused.name !== "hero") return;
  const query = String(focused.value).toLowerCase();
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
  const account = i.options.getString("account") ?? undefined;
  const link = store.get(i.guildId!, user.id, account);
  if (!link) { await i.reply({ content: missingAccountMessage(user.id, account), flags: MessageFlags.Ephemeral }); return; }
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
  await i.editReply(heroCareerView(user.id, link, mode, hero, categories, heroes));
}

async function changeCareerHero(i: StringSelectMenuInteraction) {
  const [, accountIdValue, modeValue] = i.customId.split("|");
  const heroKey = i.values[0];
  const accountId = Number(accountIdValue);
  if (!Number.isSafeInteger(accountId) || !heroKey || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That hero selector is no longer valid. Run `/ow-hero-career` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const link = store.getById(i.guildId!, accountId);
  if (!link) { await i.reply({ content: "That member's Overwatch account is no longer linked.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferUpdate();
  const heroes = await overfast.heroes();
  const hero = heroes.find(candidate => candidate.key === heroKey);
  if (!hero) { await i.editReply({ content: "That hero is no longer available.", embeds: [], components: [] }); return; }
  const categories = (await overfast.career(link.playerId, link.platform, modeValue, hero.key))[hero.key];
  if (!categories || Object.keys(categories).length === 0) {
    await i.editReply({ content: `No ${modeValue} career stats were found for **${hero.name}** on ${link.platform.toUpperCase()}.`, embeds: [], components: heroControls(link.accountId, modeValue, heroes, hero.key) });
    return;
  }
  await i.editReply(heroCareerView(link.discordUserId, link, modeValue, hero, categories, heroes));
}

async function changeCareerMode(i: ButtonInteraction) {
  const [, accountIdValue, heroKey, modeValue] = i.customId.split("|");
  const accountId = Number(accountIdValue);
  if (!Number.isSafeInteger(accountId) || !heroKey || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That mode control is no longer valid. Run `/ow-hero-career` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const link = store.getById(i.guildId!, accountId);
  if (!link) { await i.reply({ content: "That member's Overwatch account is no longer linked.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferUpdate();
  const heroes = await overfast.heroes();
  const hero = heroes.find(candidate => candidate.key === heroKey);
  if (!hero) { await i.editReply({ content: "That hero is no longer available.", embeds: [], components: [] }); return; }
  const categories = (await overfast.career(link.playerId, link.platform, modeValue, heroKey))[heroKey];
  if (!categories || Object.keys(categories).length === 0) {
    await i.editReply({ content: `No ${modeValue} career stats were found for **${hero.name}** on ${link.platform.toUpperCase()}.`, embeds: [], components: heroControls(link.accountId, modeValue, heroes, heroKey) });
    return;
  }
  await i.editReply(heroCareerView(link.discordUserId, link, modeValue, hero, categories, heroes));
}

async function showCareerSummary(i: ChatInputCommandInteraction) {
  const user = i.options.getUser("user") ?? i.user;
  const account = i.options.getString("account") ?? undefined;
  const link = store.get(i.guildId!, user.id, account);
  if (!link) { await i.reply({ content: missingAccountMessage(user.id, account), flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply();
  const mode = (i.options.getString("mode") ?? "competitive") as Gamemode;
  const [profile, stats] = await Promise.all([overfast.summary(link.playerId), overfast.stats(link.playerId, link.platform, mode)]);
  if (!stats.general) { await i.editReply(`No ${mode} career stats were found for this platform.`); return; }
  await i.editReply(summaryView(user.id, link, mode, profile.avatar, stats, "general"));
}

async function changeSummarySection(i: ButtonInteraction) {
  const [, accountIdValue, modeValue, section] = i.customId.split("|");
  const accountId = Number(accountIdValue);
  if (!Number.isSafeInteger(accountId) || !section || (modeValue !== "competitive" && modeValue !== "quickplay")) {
    await i.reply({ content: "That career control is no longer valid. Run `/ow-career` again.", flags: MessageFlags.Ephemeral });
    return;
  }
  const link = store.getById(i.guildId!, accountId);
  if (!link) { await i.reply({ content: "That member's Overwatch account is no longer linked.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferUpdate();
  const [profile, stats] = await Promise.all([overfast.summary(link.playerId), overfast.stats(link.playerId, link.platform, modeValue)]);
  await i.editReply(summaryView(link.discordUserId, link, modeValue, profile.avatar, stats, section));
}

interface HeroScoreEntry {
  userId: string;
  accountLabel: string;
  battletag: string;
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
  const links = store.listAll(i.guildId!);
  if (!links.length) { await i.editReply("Nobody has linked an Overwatch account yet."); return; }

  const entries = (await Promise.all(links.map(async link => {
    try {
      const career = await overfast.career(link.playerId, link.platform, mode, hero.key);
      return careerEntry(link, career[hero.key]);
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
  const rankedLines = displayedRanked.length
    ? displayedRanked.map((entry, index) => heroScoreLine(entry, index + 1))
    : ["*No accounts have reached the 10-game ranked minimum.*"];
  const provisionalLines = displayedProvisional.length
    ? displayedProvisional.map((entry, index) => heroScoreLine(entry, `P${index + 1}`))
    : [];
  const description = ["**Ranked**", ...rankedLines, ...(provisionalLines.length ? ["", "**Provisional**", ...provisionalLines] : [])].join("\n");

  const embed = new EmbedBuilder().setColor(0x405275)
    .setAuthor({ name: `${hero.name} Hero Score · ${mode === "competitive" ? "Competitive" : "Quick Play"}`, iconURL: hero.portrait ?? undefined })
    .setDescription(description)
    .setFooter({ text: `${titleCase(hero.role)} model · ${unranked} accounts omitted with fewer than 5 games · all linked BattleTags eligible` });
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

function careerEntry(link: LinkRecord, categories: Record<string, Record<string, string | number>> | undefined): HeroScoreEntry | null {
  if (!categories) return null;
  const game = categories.game ?? {};
  const average = categories.average ?? {};
  const games = numeric(game.games_played);
  if (games <= 0) return null;
  const wins = numeric(game.games_won || game.hero_wins);
  return {
    userId: link.discordUserId, accountLabel: link.label, battletag: link.battletag,
    games, wins, winrate: numeric(game.win_percentage) || wins / games * 100,
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
function heroScoreLine(entry: HeroScoreEntry, position: number | string) {
  const place = typeof position === "number" ? medal(position - 1) : `**${position}**`;
  return `${place} **${entry.score.toFixed(1)}** · ${entry.winrate.toFixed(1)}% WR · ${entry.games} GP\n<@${entry.userId}> · \`${entry.accountLabel}\` · ${entry.battletag}`;
}

async function showProfile(i: ChatInputCommandInteraction | UserContextMenuCommandInteraction, userId: string, mode: Gamemode, account?: string) {
  const link = store.get(i.guildId!, userId, account);
  if (!link) { await i.reply({ content: missingAccountMessage(userId, account), flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply();
  const [profile, stats] = await Promise.all([overfast.summary(link.playerId), overfast.stats(link.playerId, link.platform, mode)]);
  const s = stats.general;
  const embed = new EmbedBuilder().setColor(0xf99e1a).setTitle(`${profile.username} · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(`<@${userId}>\n**${link.battletag}** · ${link.platform.toUpperCase()} · \`${link.label}\`${link.isDefault ? " · ⭐ Default" : ""}`)
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
  const links = store.listAll(guildId);
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
  const description = rows.length
    ? rows.map((row, index) => scoreboardLine(index + 1, row.link, formatMetric(statMetric, row.stats[statMetric]))).join("\n")
    : "No public stats were available.";
  const embed = new EmbedBuilder().setColor(0x405275).setTitle(`${label} Scoreboard · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(description)
    .setFooter({ text: `${rows.length} accounts ranked · every linked BattleTag is eligible` });
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
  const description = rows.length
    ? rows.map((row, index) => scoreboardLine(index + 1, row.link, rankLabel(row.rank))).join("\n")
    : `No linked accounts have a current ${roleLabel.toLowerCase()} rank on their linked platform.`;
  const embed = new EmbedBuilder().setColor(0x405275).setTitle(`${roleLabel} Competitive Rank Scoreboard`)
    .setDescription(description)
    .setFooter({ text: `${rows.length} accounts ranked · current season · every linked BattleTag is eligible` });
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
interface CompPlayer {
  userId: string;
  accountLabel: string;
  battletag: string;
  platform: Platform;
  ranks: Partial<Record<CompRole, CompetitiveRank>>;
}

async function checkCompetitiveGroup(i: ChatInputCommandInteraction) {
  const selections = [1, 2, 3, 4, 5].flatMap(index => {
    const user = i.options.getUser(`player${index}`);
    return user ? [{ user, account: i.options.getString(`account${index}`) ?? undefined }] : [];
  });
  if (new Set(selections.map(selection => selection.user.id)).size !== selections.length) {
    await i.reply({ content: "Choose each Discord member only once.", flags: MessageFlags.Ephemeral }); return;
  }
  await i.deferReply();
  const linked = selections.map(selection => ({ ...selection, link: store.get(i.guildId!, selection.user.id, selection.account) }));
  const missing = linked.filter(item => !item.link);
  if (missing.length) {
    await i.editReply(missing.map(item => item.account
      ? `<@${item.user.id}> doesn't have an account labeled **${item.account}**.`
      : `<@${item.user.id}> hasn't linked an Overwatch account.`).join("\n"));
    return;
  }
  const platforms = new Set(linked.map(item => item.link!.platform));
  if (platforms.size > 1) {
    await i.editReply("This group mixes PC and console accounts. Overwatch Competitive does not support cross-platform groups between those pools."); return;
  }
  const players = (await Promise.all(linked.map(async item => {
    const profile = await overfast.summary(item.link!.playerId);
    const container = profile.competitive?.[item.link!.platform];
    return {
      userId: item.user.id, platform: item.link!.platform,
      accountLabel: item.link!.label, battletag: item.link!.battletag,
      ranks: { tank: container?.tank ?? undefined, damage: container?.damage ?? undefined, support: container?.support ?? undefined },
    } satisfies CompPlayer;
  })));
  const combinations = roleCombinations(players).filter(combo => isNarrowCombination(players, combo));
  const displayedCombinations = combinations.slice(0, 20);
  const embed = new EmbedBuilder().setColor(combinations.length ? 0x57f287 : 0xed4245)
    .setTitle(combinations.length ? "Narrow Competitive Combinations" : "No Confirmed Narrow Combination")
    .setDescription(combinations.length
      ? competitiveCombinationTable(players, displayedCombinations)
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
function competitiveCombinationTable(players: CompPlayer[], combinations: CompRole[][]) {
  const legend = players.map((player, index) => `**P${index + 1}** <@${player.userId}> · \`${player.accountLabel}\` · ${player.battletag}`).join("\n");
  const rows = combinations.map((roles, rowIndex) =>
    `**${rowIndex + 1}.** ${roles.map((role, playerIndex) => `P${playerIndex + 1} **${roleEmoji(role)} ${titleCase(role)}** · ${shortRankLabel(players[playerIndex]!.ranks[role]!)}`).join("\n　")}`);
  return [legend, "", "**Valid role assignments**", ...rows].join("\n");
}
function roleEmoji(role: CompRole) { return role === "tank" ? "🛡️" : role === "damage" ? "⚔️" : "✚"; }
function shortRankLabel(rank: CompetitiveRank) {
  const divisions: Record<string, string> = {
    bronze: "Br", silver: "Si", gold: "Go", platinum: "Pl", diamond: "Di", master: "Ma", grandmaster: "GM", champion: "Ch",
  };
  return `${divisions[rank.division.toLowerCase()] ?? rank.division.slice(0, 2)}${rank.tier}`;
}

function statFields(s: StatsSummary) { return [
  { name: "Win Rate", value: `${s.winrate.toFixed(1)}%`, inline: true },
  { name: "Record", value: `${s.games_won}W – ${s.games_lost}L`, inline: true },
  { name: "KDA", value: s.kda.toFixed(2), inline: true },
  { name: "Elims / 10", value: s.average.eliminations.toFixed(1), inline: true },
  { name: "Assists / 10", value: s.average.assists.toFixed(1), inline: true },
  { name: "Damage / 10", value: Math.round(s.average.damage).toLocaleString(), inline: true },
  { name: "Healing / 10", value: Math.round(s.average.healing).toLocaleString(), inline: true },
]; }
function formatMetric(metric: string, value: number) { return metric === "winrate" ? `${value.toFixed(1)}%` : metric === "kda" ? value.toFixed(2) : String(value); }
function medal(index: number) { return ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`; }
function heroCareerView(
  userId: string,
  link: LinkRecord,
  mode: Gamemode,
  hero: { key: string; name: string; portrait: string | null },
  categories: Record<string, Record<string, string | number>>,
  heroes: Array<{ key: string; name: string; role: string }>,
) {
  const embed = new EmbedBuilder().setColor(0xf99e1a)
    .setTitle(`${hero.name} Career · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(`<@${userId}>\n**${link.battletag}** · ${link.platform.toUpperCase()} · \`${link.label}\`${link.isDefault ? " · ⭐ Default" : ""}`)
    .setThumbnail(hero.portrait)
    .addFields(heroCareerFields(categories))
    .setFooter({ text: "Average is per 10 minutes · Stats supplied by OverFast API" });
  return { content: "", embeds: [embed], components: heroControls(link.accountId, mode, heroes, hero.key) };
}

function heroControls(accountId: number, mode: Gamemode, heroes: Array<{ key: string; name: string; role: string }>, selected: string) {
  const modeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`owm|${accountId}|${selected}|competitive`).setLabel("Competitive")
      .setStyle(mode === "competitive" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(mode === "competitive"),
    new ButtonBuilder().setCustomId(`owm|${accountId}|${selected}|quickplay`).setLabel("Quick Play")
      .setStyle(mode === "quickplay" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(mode === "quickplay"),
  );
  return [modeRow, ...heroSelectorRows(accountId, mode, heroes, selected)];
}

function heroSelectorRows(accountId: number, mode: Gamemode, heroes: Array<{ key: string; name: string; role: string }>, selected: string) {
  return ["tank", "damage", "support"].flatMap(role => {
    const options = heroes.filter(hero => hero.role === role).slice(0, 25);
    if (!options.length) return [];
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`owh|${accountId}|${mode}|${role}`)
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

function summaryView(userId: string, link: LinkRecord, mode: Gamemode, avatar: string | null, stats: import("./types.js").PlayerStatsSummary, selected: string) {
  const available: Array<[string, StatsSummary | null | undefined]> = [["general", stats.general], ["tank", stats.roles?.tank], ["damage", stats.roles?.damage], ["support", stats.roles?.support]];
  const current = available.find(([key]) => key === selected)?.[1] ?? stats.general;
  const embed = new EmbedBuilder().setColor(0xf99e1a)
    .setTitle(`${titleCase(selected)} Career · ${mode === "competitive" ? "Competitive" : "Quick Play"}`)
    .setDescription(`<@${userId}>\n**${link.battletag}** · ${link.platform.toUpperCase()} · \`${link.label}\`${link.isDefault ? " · ⭐ Default" : ""}`)
    .setThumbnail(avatar)
    .setFooter({ text: "Averages are per 10 minutes · Stats supplied by OverFast API" });
  if (current) embed.addFields(summaryFields(current));
  else embed.addFields({ name: "No stats", value: `No ${selected} stats were found.`, inline: false });
  const buttons = available.filter(([, value]) => value).map(([key]) => new ButtonBuilder()
    .setCustomId(`ows|${link.accountId}|${mode}|${key}`).setLabel(titleCase(key))
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
function scoreboardLine(position: number, link: LinkRecord, value: string) {
  return `${medal(position - 1)} **${value}** · <@${link.discordUserId}>\n　${link.battletag} · \`${link.label}\` · ${link.platform.toUpperCase()}`;
}
function missingAccountMessage(userId: string, account?: string) {
  return account ? `⚠️ **Account not found**\n<@${userId}> doesn't have an account labeled \`${account}\`.` : `⚠️ **No linked account**\n<@${userId}> can use \`/ow-link\` to add one.`;
}

await client.login(config.token());
