import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config } from "./config.js";

const rest = new REST().setToken(config.token());
const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId(), config.guildId)
  : Routes.applicationCommands(config.clientId());
await rest.put(route, { body: commands });
console.log(`Registered ${commands.length} ${config.guildId ? "guild" : "global"} commands.`);
