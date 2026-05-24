const { Client, GatewayIntentBits, TextChannel, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { status } = require('minecraft-server-util');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const rawChannelId = process.env.DISCORD_CHANNEL_ID ?? '';
const CHANNEL_ID = rawChannelId.includes('discord.com/channels/') ? rawChannelId.split('/').pop() : rawChannelId;

const SERVER_HOST = 'kHRX-3.aternos.me';
const SERVER_PORT = 39034;
const POLL_INTERVAL_MS = 10 * 60 * 1000;

if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');
if (!CHANNEL_ID) throw new Error('DISCORD_CHANNEL_ID is required');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let lastMessageId = null;

async function getServerStatus() {
  try {
    const res = await status(SERVER_HOST, SERVER_PORT, { timeout: 5000 });
    return { online: true, playersOnline: res.players.online, playersMax: res.players.max };
  } catch { return { online: false, playersOnline: 0, playersMax: 0 }; }
}

function buildEmbed(online, playersOnline, playersMax) {
  const timeStr = new Date().toUTCString().replace('GMT', 'UTC');
  if (online) {
    return new EmbedBuilder().setColor(0x57f287).setTitle('🟢  HRX SMP')
      .addFields(
        { name: '📡 Status', value: 'Online', inline: true },
        { name: '👥 Players', value: `${playersOnline} / ${playersMax}`, inline: true },
        { name: '🌍 IP Address', value: `\`${SERVER_HOST}:${SERVER_PORT}\``, inline: false }
      ).setFooter({ text: `Last updated • ${timeStr}` });
  }
  return new EmbedBuilder().setColor(0xed4245).setTitle('🔴  HRX SMP')
    .addFields(
      { name: '📡 Status', value: 'Offline', inline: true },
      { name: '🌍 IP Address', value: `\`${SERVER_HOST}:${SERVER_PORT}\``, inline: false }
    ).setFooter({ text: `Last updated • ${timeStr}` });
}

async function checkAndPost() {
  const { online, playersOnline, playersMax } = await getServerStatus();
  const embed = buildEmbed(online, playersOnline, playersMax);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) return;
    if (lastMessageId) {
      try {
        const existing = await channel.messages.fetch(lastMessageId);
        await existing.edit({ embeds: [embed] });
        console.log(`[${new Date().toISOString()}] Edited: ${online ? 'Online' : 'Offline'}`);
        return;
      } catch { lastMessageId = null; }
    }
    const sent = await channel.send({ embeds: [embed] });
    lastMessageId = sent.id;
    console.log(`[${new Date().toISOString()}] Sent: ${online ? 'Online' : 'Offline'}`);
  } catch (err) { console.error('Discord error:', err.message); }
}

async function registerCommands(clientId) {
  const command = new SlashCommandBuilder().setName('status').setDescription('Check the current HRX SMP server status');
  const rest = new REST().setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: [command.toJSON()] });
    console.log('Registered /status command');
  } catch (err) { console.error('Failed to register command:', err.message); }
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
  await interaction.editReply({ embeds: [buildEmbed(online, playersOnline, playersMax)] });
});

client.login(TOKEN);
