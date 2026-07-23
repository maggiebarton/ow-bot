import { ApplicationCommandType, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder().setName("ow-link").setDescription("Link an Overwatch account")
    .addStringOption(o => o.setName("battletag").setDescription("BattleTag, e.g. Player#1234").setRequired(true))
    .addStringOption(o => o.setName("platform").setDescription("Where you play").setRequired(true)
      .addChoices({ name: "PC", value: "pc" }, { name: "Console", value: "console" }))
    .addStringOption(o => o.setName("account").setDescription("Account label, e.g. main, alt, or console"))
    .addBooleanOption(o => o.setName("default").setDescription("Make this the default account"))
    .addUserOption(o => o.setName("user").setDescription("Member to link (Manage Server required for others)")),
  new SlashCommandBuilder().setName("ow-unlink").setDescription("Remove one of your linked Overwatch accounts")
    .addStringOption(o => o.setName("account").setDescription("Account to remove (defaults to your default)").setAutocomplete(true)),
  new SlashCommandBuilder().setName("ow-profile").setDescription("Show a linked player's Overwatch stats")
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)"))
    .addStringOption(o => o.setName("account").setDescription("Account to use (defaults to their default)").setAutocomplete(true))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-career").setDescription("Show overall and role career summaries")
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)"))
    .addStringOption(o => o.setName("account").setDescription("Account to use (defaults to their default)").setAutocomplete(true))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-hero-career").setDescription("Show detailed career stats for a hero")
    .addStringOption(o => o.setName("hero").setDescription("Start typing a hero name").setRequired(true).setAutocomplete(true))
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)"))
    .addStringOption(o => o.setName("account").setDescription("Account to use (defaults to their default)").setAutocomplete(true))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-hero-scoreboard").setDescription("Rank server members on a specific hero")
    .addStringOption(o => o.setName("hero").setDescription("Start typing a hero name").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("mode").setDescription("Stats mode").addChoices(
      { name: "Competitive", value: "competitive" }, { name: "Quick Play", value: "quickplay" })),
  new SlashCommandBuilder().setName("ow-meme").setDescription("Post a random Overwatch meme"),
  new SlashCommandBuilder().setName("ow-random-hero").setDescription("Pick a random hero for you to play")
    .addStringOption(o => o.setName("role").setDescription("Limit the pick to one role (defaults to all roles)").addChoices(
      { name: "All Roles", value: "all" }, { name: "Tank", value: "tank" },
      { name: "Damage", value: "damage" }, { name: "Support", value: "support" })),
  new SlashCommandBuilder().setName("ow-counters").setDescription("Find the best ban votes for the hero you plan to play")
    .addStringOption(o => o.setName("hero").setDescription("Start typing the hero you plan to play").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("tier").setDescription("Override the Competitive tier from your default linked account").addChoices(
      { name: "All Tiers", value: "All" }, { name: "Bronze", value: "Bronze" }, { name: "Silver", value: "Silver" },
      { name: "Gold", value: "Gold" }, { name: "Platinum", value: "Platinum" }, { name: "Diamond", value: "Diamond" },
      { name: "Master", value: "Master" }, { name: "Grandmaster & Champion", value: "Grandmaster" }))
    .addStringOption(o => o.setName("input").setDescription("Override the input pool from your default linked account").addChoices(
      { name: "Mouse & Keyboard", value: "PC" }, { name: "Controller", value: "Console" })),
  new SlashCommandBuilder().setName("ow-synergies").setDescription("Find the best teammates for the hero you plan to play")
    .addStringOption(o => o.setName("hero").setDescription("Start typing the hero you plan to play").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("ow-tag").setDescription("Show a member's saved BattleTag")
    .addUserOption(o => o.setName("user").setDescription("Discord member (defaults to you)"))
    .addStringOption(o => o.setName("account").setDescription("One account, or omit to list all").setAutocomplete(true)),
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
    .addUserOption(o => o.setName("player5").setDescription("Fifth member"))
    .addStringOption(o => o.setName("account1").setDescription("Account label for player 1 (defaults to their default)").setAutocomplete(true))
    .addStringOption(o => o.setName("account2").setDescription("Account label for player 2 (defaults to their default)").setAutocomplete(true))
    .addStringOption(o => o.setName("account3").setDescription("Account label for player 3 (defaults to their default)").setAutocomplete(true))
    .addStringOption(o => o.setName("account4").setDescription("Account label for player 4 (defaults to their default)").setAutocomplete(true))
    .addStringOption(o => o.setName("account5").setDescription("Account label for player 5 (defaults to their default)").setAutocomplete(true)),
  { name: "View Overwatch Stats", type: ApplicationCommandType.User },
].map(c => "toJSON" in c ? c.toJSON() : c);
