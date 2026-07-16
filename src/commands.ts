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
  new SlashCommandBuilder().setName("ow-career").setDescription("Show overall and role career summaries")
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)"))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-hero-career").setDescription("Show detailed career stats for a hero")
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
      { name: "Win rate", value: "winrate" }, { name: "KDA", value: "kda" }, { name: "Games won", value: "games_won" },
      { name: "Tank competitive rank", value: "rank_tank" }, { name: "Damage competitive rank", value: "rank_damage" },
      { name: "Support competitive rank", value: "rank_support" }, { name: "Open Queue (6v6) competitive rank", value: "rank_open" }))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-comp-check").setDescription("Find narrow-group role combinations for linked members")
    .addUserOption(o => o.setName("player1").setDescription("First member").setRequired(true))
    .addUserOption(o => o.setName("player2").setDescription("Second member").setRequired(true))
    .addUserOption(o => o.setName("player3").setDescription("Third member"))
    .addUserOption(o => o.setName("player4").setDescription("Fourth member"))
    .addUserOption(o => o.setName("player5").setDescription("Fifth member")),
  { name: "View Overwatch Stats", type: ApplicationCommandType.User },
].map(c => "toJSON" in c ? c.toJSON() : c);
