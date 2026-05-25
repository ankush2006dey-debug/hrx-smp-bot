const {
  Client,
  GatewayIntentBits,
  TextChannel,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const { status } = require('minecraft-server-util');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const rawChannelId = process.env.DISCORD_CHANNEL_ID ?? '';
const CHANNEL_ID = rawChannelId.includes('discord.com/channels/')
  ? rawChannelId.split('/').pop()
  : rawChannelId;

const SERVER_HOST = 'kHRX-3.aternos.me';
const SERVER_PORT = 39034;
const POLL_INTERVAL_MS = 60 * 1000;
const THUMBNAIL = 'https://481fbf75-a98f-4071-8eba-fb01b7084ee1-00-1y0azzefcprq9.pike.replit.dev/api/assets/thumbnail.png';

if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');
if (!CHANNEL_ID) throw new Error('DISCORD_CHANNEL_ID is required');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let lastKnownOnline = null;
let pendingStatus = null;
let pendingCount = 0;
const CONFIRM_CHECKS = 1;

async function getServerStatus() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await status(SERVER_HOST, SERVER_PORT, { timeout: 10000 });
      return { online: true, playersOnline: res.players.online, playersMax: res.players.max };
    } catch {
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return { online: false, playersOnline: 0, playersMax: 0 };
}

function buildEmbed(online, playersOnline, playersMax) {
  const timeStr = new Date().toUTCString().replace('GMT', 'UTC');
  if (online) {
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('🟢  HRX SMP')
      .addFields(
        { name: '📡 Status', value: 'Online', inline: true },
        { name: '👥 Players', value: `${playersOnline} / ${playersMax}`, inline: true },
        { name: '🌍 IP Address', value: `\`${SERVER_HOST}:${SERVER_PORT}\``, inline: false },
      )
      .setThumbnail(THUMBNAIL)
      .setFooter({ text: `Last updated • ${timeStr}` });
  }
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🔴  HRX SMP')
    .addFields(
      { name: '📡 Status', value: 'Offline', inline: true },
      { name: '🌍 IP Address', value: `\`${SERVER_HOST}:${SERVER_PORT}\``, inline: false },
    )
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: `Last updated • ${timeStr}` });
}

async function checkAndPost() {
  const { online, playersOnline, playersMax } = await getServerStatus();

  if (lastKnownOnline === online) {
    pendingStatus = null;
    pendingCount = 0;
    return;
  }

  if (pendingStatus === online) {
    pendingCount++;
  } else {
    pendingStatus = online;
    pendingCount = 1;
  }

  if (pendingCount < CONFIRM_CHECKS) return;

  const wasUnknown = lastKnownOnline === null;
  lastKnownOnline = online;
  pendingStatus = null;
  pendingCount = 0;

  if (wasUnknown && !online) return;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) {
      console.error('Channel not found or not a text channel:', CHANNEL_ID);
      return;
    }

    const embed = buildEmbed(online, playersOnline, playersMax);
    const content = online
      ? '@everyone 🟢 **HRX SMP is now Online!** Come join!'
      : '@everyone 🔴 **HRX SMP just went Offline.**';

    await channel.send({ content, embeds: [embed] });
    console.log(`[${new Date().toISOString()}] Sent: ${online ? 'Online' : 'Offline'}`);
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
  await interaction.deferReply({ ephemeral: true });
  const { online, playersOnline, playersMax } = await getServerStatus();
  await interaction.editReply({ embeds: [buildEmbed(online, playersOnline, playersMax)] });
  console.log(`[${new Date().toISOString()}] Responded to /status`);
});

client.login(TOKEN);
