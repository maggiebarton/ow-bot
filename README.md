# OW Bot

A Discord bot for linking BattleTags, viewing Overwatch profiles and hero career stats, and comparing linked server members using the [OverFast API](https://overfast-api.tekrop.fr/).

## Features

- Persistent BattleTag links scoped to each Discord server
- PC and console profiles with Competitive and Quick Play filters
- Current profile summaries and detailed, per-hero career statistics
- Live hero autocomplete sourced from OverFast's `/heroes` endpoint
- Server-wide raw-stat and role-aware hero scoreboards
- Discord user context command for quickly viewing another member's stats

## Commands

- `/ow-link battletag platform [user]` — validate and remember an account. Linking someone else requires **Manage Server**
- `/ow-profile [user] [mode]` — show headline stats for yourself or another linked member. Mode defaults to Competitive
- `/ow-career hero [user] [mode]` — show detailed hero career stats with live hero autocomplete and buttons for switching sections
- `/ow-hero-scoreboard hero [mode]` — show the role-aware Hero Score ranking for a particular hero
- `/ow-tag [user]` — retrieve a saved BattleTag for adding a friend
- `/ow-scoreboard [metric] [mode]` — rank linked members by raw win rate, KDA, or games won
- `/ow-unlink` — delete your own link from the current server
- Right-click a member → Apps → **View Overwatch Stats**

Users may enter a BattleTag as either `magsauce#11831` or `magsauce-11831`. The bot converts `#` to `-` for OverFast and displays the familiar `#` form in Discord.

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

- Links are stored in the SQLite file configured by `DATABASE_PATH` and scoped per Discord server.
- Scoreboards and career views fetch current data when requested. OverFast generally caches player data for about 10 minutes.
- Hero autocomplete data is cached by the bot for 24 hours.
- OverFast can only expose career stats for public Overwatch career profiles.
- If OverFast cannot find a player, the bot displays when the API can check Blizzard again. This is a retry backoff: a later request triggers the next lookup; it is not an automatic refresh.
- Each member chooses PC or console when linking, and can run `/ow-link` again to replace the saved account/platform.
- Anyone can link themselves. Linking or replacing another member's account requires the Discord **Manage Server** permission.
- Back up the file under `data/` if self-hosting. A hosted database is the natural upgrade before running multiple bot instances.
