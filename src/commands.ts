import { ApplicationCommandType, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder().setName("ow-link").setDescription("Link an Overwatch account")
    .addStringOption(o => o.setName("battletag").setDescription("BattleTag, e.g. Player#1234").setRequired(true))
    .addStringOption(o => o.setName("platform").setDescription("Where you play").setRequired(true)
      .addChoices({ name: "PC", value: "pc" }, { name: "Console", value: "console" }))
    .addUserOption(o => o.setName("user").setDescription("Member to link (Manage Server required for others)")),
  new SlashCommandBuilder().setName("ow-unlink").setDescription("Remove your linked Overwatch account"),
  new SlashCommandBuilder().setName("ow-profile").setDescription("Show a linked player's Overwatch stats")
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)"))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-career").setDescription("Show detailed career stats for a hero")
    .addStringOption(o => o.setName("hero").setDescription("Start typing a hero name").setRequired(true).setAutocomplete(true))
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)"))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-hero-scoreboard").setDescription("Rank server members on a specific hero")
    .addStringOption(o => o.setName("hero").setDescription("Start typing a hero name").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-tag").setDescription("Show a member's saved BattleTag")
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)")),
  new SlashCommandBuilder().setName("ow-scoreboard").setDescription("Rank linked members by an Overwatch stat")
    .addStringOption(o => o.setName("metric").setDescription("Score to rank").addChoices(
      { name: "Win rate", value: "winrate" }, { name: "KDA", value: "kda" }, { name: "Games won", value: "games_won" }))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  { name: "View Overwatch Stats", type: ApplicationCommandType.User },
].map(c => "toJSON" in c ? c.toJSON() : c);
