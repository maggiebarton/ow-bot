<p align="center">
  <img src="assets/oversauce.png" alt="OverSauce logo" width="320">
</p>

# OverSauce

OverSauce is a Discord bot for linking BattleTags, viewing Overwatch profiles and hero career stats, and comparing linked server members using the [OverFast API](https://overfast-api.tekrop.fr/).

## Features

- Multiple persistent BattleTag links per Discord member, scoped to each server
- PC and console profiles with Competitive and Quick Play filters
- Overall and role career summaries with interactive role buttons
- Detailed hero career cards grouping per-10-minute averages, best games, and totals
- In-message hero selectors and Competitive/Quick Play toggles
- Live hero autocomplete sourced from OverFast's `/heroes` endpoint
- Mobile-first server-wide raw-stat and role-aware hero scoreboards, with compact stacked entries that stay readable on narrow screens
- Discord user context command for quickly viewing another member's stats

## Commands

- `/ow-link battletag platform [account] [default] [user]` — add or update a labeled account. Linking someone else requires **Manage Server**
- `/ow-profile [user] [account] [mode]` — show headline stats for yourself or another linked member. Mode defaults to Competitive
- `/ow-career [user] [account] [mode]` — show general career stats with buttons for General, Tank, Damage, and Support summaries
- `/ow-hero-career hero [user] [account] [mode]` — show grouped hero statistics, then switch heroes or modes without rerunning the command
- `/ow-hero-scoreboard hero [mode]` — show the role-aware Hero Score ranking for a particular hero
- `/ow-meme` — post a random original Overwatch meme, with an **Another one** button
- `/ow-random-hero [role]` — pick a random hero from all roles or limit the choice to Tank, Damage, or Support; use **Reroll** for another pick
- `/ow-tag [user] [account]` — list a member's saved BattleTags or retrieve one labeled account
- `/ow-scoreboard [metric] [mode]` — rank linked members by win rate, KDA, games won, or current Tank/Damage/Support/Open Queue (6v6) competitive rank
- `/ow-comp-check player1 player2 [player3] [player4] [player5] [account1] … [account5]` — find narrow-group role assignments using a selected account label for each member (or their default), displayed as mobile-friendly stacked assignments
- `/ow-unlink [account]` — delete a labeled account, or your default account when no label is supplied
- Right-click a member → Apps → **View Overwatch Stats**

Users may enter a BattleTag as either `magsauce#11831` or `magsauce-11831`. The bot converts `#` to `-` for OverFast and displays the familiar `#` form in Discord.

Account labels use 1–20 letters, numbers, underscores, or hyphens. The first account linked becomes the default; pass `default:True` to `/ow-link` to change it. Commands use the default when `account` is omitted. Server scoreboards rank every linked account separately and show both its label and BattleTag.

Hero-career averages are values returned by OverFast and represent rates per 10 minutes; OverSauce does not calculate them. If Blizzard reports activity but zero completed games, OverSauce labels it as partial activity rather than showing a misleading 0–0 record.

## Hero Score

`/ow-hero-scoreboard` produces a transparent score from 0–100. Scores are relative to linked members in the current server who have public stats for the selected hero and mode.

- **40% adjusted win rate** — Bayesian smoothing pulls small samples toward the server's weighted average
- **25% role performance** — different per-10-minute metrics are used for Tank, Damage, and Support
- **20% survivability** — fewer deaths per 10 minutes scores higher
- **15% experience** — games played increase confidence with diminishing returns

Members need at least 10 games on the hero to rank. Players with 5–9 games appear as provisional, while players with fewer than 5 games are omitted. The scoreboard's **How scoring works** button shows these rules inside Discord.

## First-time setup

1. Install [Node.js 22 or newer](https://nodejs.org/), then install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values:

   ```env
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_application_id
   DISCORD_GUILD_ID=your_test_server_id
   DATABASE_PATH=./data/ow-bot.db
   OVERFAST_BASE_URL=https://overfast-api.tekrop.fr
   ```

3. In the [Discord Developer Portal](https://discord.com/developers/applications), open your application:
   - **General Information** → copy **Application ID** to `DISCORD_CLIENT_ID`.
   - **Bot** → reset/copy the token to `DISCORD_TOKEN`. Never commit or share it.
   - In Discord, enable Developer Mode, right-click your test server, and copy its ID to `DISCORD_GUILD_ID`.
4. On **Installation**, enable **Guild Install** with the `bot` and `applications.commands` scopes. Grant **Send Messages**, **Embed Links**, and **Use Application Commands**, then open the installation link and add the bot to the server.
5. Register the slash and context commands:

   ```sh
   npm run deploy-commands
   ```

6. Start the bot in development mode:

   ```sh
   npm run dev
   ```

Keep the terminal open while using the bot. It connects outbound to Discord, so members can use it from any network without port forwarding. The bot goes offline if the process stops, the computer sleeps, or its internet connection drops.

Guild commands appear immediately. Rerun `npm run deploy-commands` whenever command names or options change. When the bot is ready for multiple servers, remove `DISCORD_GUILD_ID` and run the deployment command once to register global commands.

## Development

```sh
npm run build
npm test
```

`npm run dev` watches the TypeScript source and restarts the bot after code changes. Use `Ctrl+C` to stop it.

## Notes

- Links are stored in the SQLite file configured by `DATABASE_PATH` and scoped per Discord server. Existing single-account databases migrate automatically, labeling every existing link `main` and keeping it as the default.
- Scoreboards and career views fetch current data when requested. OverFast generally caches player data for about 10 minutes.
- Hero autocomplete data is cached by the bot for 24 hours.
- `/ow-hero-career` includes Tank, Damage, and Support hero selectors plus Competitive and Quick Play toggle buttons. These controls update the existing Discord message.
- Competitive-rank scoreboards use each member's linked platform and current `/summary` role or Open Queue (6v6) rank. Unranked members are omitted; the mode option does not apply to rank metrics.
- `/ow-comp-check` evaluates every valid 1 Tank/2 Damage/2 Support role assignment using published ranks. It requires one platform pool, excludes unranked role choices, and uses narrow ranges of 10 divisions through Diamond, 5 in Master/Grandmaster, and 3 in Champion.
- OverFast can only expose career stats for public Overwatch career profiles.
- If OverFast cannot find a player, the bot displays when the API can check Blizzard again. This is a retry backoff: a later request triggers the next lookup; it is not an automatic refresh.
- Each member chooses PC or console when linking, and can run `/ow-link` again to replace the saved account/platform.
- Anyone can link themselves. Linking or replacing another member's account requires the Discord **Manage Server** permission.
- Back up the file under `data/` if self-hosting. A hosted database is the natural upgrade before running multiple bot instances.
