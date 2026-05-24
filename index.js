const { Client, GatewayIntentBits, TextChannel, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { status } = require('minecraft-server-util');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const rawChannelId = process.env.DISCORD_CHANNEL_ID ?? '';
const CHANNEL_ID = rawChannelId.includes('discord.com/channels/')
  ? rawChannelId.split('/').pop()
  : rawChannelId;

const SERVER_HOST = 'kHRX-3.aternos.me';
const SERVER_PORT = 39034;
const POLL_INTERVAL_MS = 10 * 60 * 1000;

if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');
if (!CHANNEL_ID) throw new Error('DISCORD_CHANNEL_ID is required');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function getServerStatus() {
  try {
    const res = await status(SERVER_HOST, SERVER_PORT, { timeout: 5000 });
    return { online: true, playersOnline: res.players.online, playersMax: res.players.max };
  } catch {
    return { online: false, playersOnline: 0, playersMax: 0 };
  }
}

function buildMessage(online, playersOnline, playersMax) {
  if (online) {
    return `🟢 **HRX SMP**\n\n📡 Status: Online\n👥 Players: ${playersOnline}/${playersMax}\n\n🌍 IP: ${SERVER_HOST}:${SERVER_PORT}`;
  }
  return `🔴 **HRX SMP**\n\n📡 Status: Offline\n\n🌍 IP: ${SERVER_HOST}:${SERVER_PORT}`;
}

async function checkAndPost() {
  const { online, playersOnline, playersMax } = await getServerStatus();
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) {
      console.error('Channel not found or not a text channel:', CHANNEL_ID);
      return;
    }
    await channel.send(buildMessage(online, playersOnline, playersMax));
    console.log(`[${new Date().toISOString()}] Posted: ${online ? 'Online' : 'Offline'} | Players: ${playersOnline}/${playersMax}`);
  } catch (err) {
    console.error('Failed to post to Discord:', err.message);
  }
}

async function registerCommands(clientId) {
  const command = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the current HRX SMP server status');
  const rest = new REST().setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: [command.toJSON()] });
    console.log('Registered /status slash command');
  } catch (err) {
    console.error('Failed to register slash command:', err.message);
  }
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(client.user.id);
  checkAndPost();
  setInterval(checkAndPost, POLL_INTERVAL_MS);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'status') return;
  await interaction.deferReply();
  const { online, playersOnline, playersMax } = await getServerStatus();
  await interaction.editReply(buildMessage(online, playersOnline, playersMax));
  console.log(`[${new Date().toISOString()}] Responded to /status command`);
});

client.login(TOKEN);
