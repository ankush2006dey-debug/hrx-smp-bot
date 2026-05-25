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

if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');

const POLL_INTERVAL_MS = 60 * 1000;
const CONFIRM_CHECKS = 3;

function parseChannelId(raw) {
  return raw && raw.includes('discord.com/channels/') ? raw.split('/').pop() : raw;
}

const SERVERS = [
  {
    name: 'HRX SMP',
    host: 'kHRX-3.aternos.me',
    port: 39034,
    channelId: parseChannelId(process.env.DISCORD_CHANNEL_ID ?? ''),
    lastKnownOnline: null,
    pendingStatus: null,
    pendingCount: 0,
    lastPlayers: [],
  },
  {
    name: 'Royal SMP',
    host: 'Tiger_SMP_111.aternos.me',
    port: 11067,
    channelId: parseChannelId(process.env.DISCORD_CHANNEL_ID_2 ?? ''),
    lastKnownOnline: null,
    pendingStatus: null,
    pendingCount: 0,
    lastPlayers: [],
  },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function getServerStatus(host, port) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await status(host, port, { timeout: 10000 });
      const players = (res.players.sample || []).map(p => p.name).filter(Boolean);
      return {
        online: true,
        playersOnline: res.players.online,
        playersMax: res.players.max,
        players,
      };
    } catch {
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return { online: false, playersOnline: 0, playersMax: 0, players: [] };
}

function buildEmbed(name, host, port, online, playersOnline, playersMax, players) {
  const timeStr = new Date().toUTCString().replace('GMT', 'UTC');
  if (online) {
    const playerList = players.length > 0 ? players.map(p => `• ${p}`).join('\n') : '_No player names available_';
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`🟢  ${name} — Online`)
      .addFields(
        { name: '📡 Status', value: 'Online', inline: true },
        { name: '👥 Players', value: `${playersOnline} / ${playersMax}`, inline: true },
        { name: '🌍 IP Address', value: `\`${host}:${port}\``, inline: false },
        ...(playersOnline > 0 ? [{ name: '🧑‍💻 Online Players', value: playerList, inline: false }] : []),
      )
      .setFooter({ text: `Last updated • ${timeStr}` });
  }
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`🔴  ${name} — Offline`)
    .addFields(
      { name: '📡 Status', value: 'Offline', inline: true },
      { name: '🌍 IP Address', value: `\`${host}:${port}\``, inline: false },
    )
    .setFooter({ text: `Last updated • ${timeStr}` });
}

// Sends current status to a server's channel immediately (used on startup)
async function sendStartupStatus(srv) {
  if (!srv.channelId) {
    console.warn(`[${srv.name}] No channel ID configured — skipping startup status`);
    return;
  }
  try {
    const { online, playersOnline, playersMax, players } = await getServerStatus(srv.host, srv.port);
    srv.lastPlayers = players;
    srv.lastKnownOnline = online;

    const channel = await client.channels.fetch(srv.channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      console.error(`[${srv.name}] Channel not found or not a text channel: ${srv.channelId}`);
      return;
    }
    const embed = buildEmbed(srv.name, srv.host, srv.port, online, playersOnline, playersMax, players);
    const content = online
      ? `🟢 **${srv.name} is Online!** Come join!`
      : `🔴 **${srv.name} is currently Offline.**`;
    await channel.send({ content, embeds: [embed] });
    console.log(`[${new Date().toISOString()}] [${srv.name}] Startup status sent: ${online ? 'Online' : 'Offline'}`);
  } catch (err) {
    console.error(`[${srv.name}] Failed to send startup status:`, err.message);
  }
}

async function checkServer(srv) {
  if (!srv.channelId) {
    console.warn(`[${srv.name}] No channel ID configured — skipping`);
    return;
  }

  const { online, playersOnline, playersMax, players } = await getServerStatus(srv.host, srv.port);
  srv.lastPlayers = players;

  if (srv.lastKnownOnline === online) {
    srv.pendingStatus = null;
    srv.pendingCount = 0;
    return;
  }

  if (srv.pendingStatus === online) {
    srv.pendingCount++;
  } else {
    srv.pendingStatus = online;
    srv.pendingCount = 1;
  }

  if (srv.pendingCount < CONFIRM_CHECKS) {
    console.log(`[${srv.name}] Status change pending (${srv.pendingCount}/${CONFIRM_CHECKS}): ${online ? 'Online' : 'Offline'}`);
    return;
  }

  srv.lastKnownOnline = online;
  srv.pendingStatus = null;
  srv.pendingCount = 0;

  try {
    const channel = await client.channels.fetch(srv.channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      console.error(`[${srv.name}] Channel not found or not a text channel: ${srv.channelId}`);
      return;
    }
    const embed = buildEmbed(srv.name, srv.host, srv.port, online, playersOnline, playersMax, players);
    const content = online
      ? `🟢 **${srv.name} is now Online!** Come join!`
      : `🔴 **${srv.name} just went Offline.**`;
    await channel.send({ content, embeds: [embed] });
    console.log(`[${new Date().toISOString()}] [${srv.name}] Notification sent: ${online ? 'Online' : 'Offline'}`);
  } catch (err) {
    console.error(`[${srv.name}] Failed to post notification:`, err.message);
  }
}

async function checkAll() {
  await Promise.all(SERVERS.map(srv => checkServer(srv)));
}

async function registerCommands(clientId) {
  const statusCmd = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the current Minecraft server status')
    .addStringOption(opt =>
      opt.setName('server')
        .setDescription('Which server to check')
        .setRequired(false)
        .addChoices(...SERVERS.map(s => ({ name: s.name, value: s.name })))
    );

  const playersCmd = new SlashCommandBuilder()
    .setName('players')
    .setDescription('See who is currently online on a Minecraft server')
    .addStringOption(opt =>
      opt.setName('server')
        .setDescription('Which server to check')
        .setRequired(false)
        .addChoices(...SERVERS.map(s => ({ name: s.name, value: s.name })))
    );

  const rest = new REST().setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(clientId), {
      body: [statusCmd.toJSON(), playersCmd.toJSON()],
    });
    console.log('Registered /status and /players slash commands');
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(client.user.id);

  // Send current status to all channels immediately on startup
  await Promise.all(SERVERS.map(srv => sendStartupStatus(srv)));

  // Then begin polling for changes
  setInterval(checkAll, POLL_INTERVAL_MS);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'status') {
    await interaction.deferReply({ ephemeral: true });
    const chosen = interaction.options.getString('server');
    const srv = chosen ? SERVERS.find(s => s.name === chosen) : SERVERS[0];
    if (!srv) { await interaction.editReply('Server not found.'); return; }
    const { online, playersOnline, playersMax, players } = await getServerStatus(srv.host, srv.port);
    srv.lastPlayers = players;
    await interaction.editReply({
      embeds: [buildEmbed(srv.name, srv.host, srv.port, online, playersOnline, playersMax, players)],
    });
    console.log(`[${new Date().toISOString()}] /status for ${srv.name}: ${online ? 'Online' : 'Offline'}`);
  }

  if (interaction.commandName === 'players') {
    await interaction.deferReply({ ephemeral: true });
    const chosen = interaction.options.getString('server');
    const srv = chosen ? SERVERS.find(s => s.name === chosen) : SERVERS[0];
    if (!srv) { await interaction.editReply('Server not found.'); return; }
    const { online, playersOnline, playersMax, players } = await getServerStatus(srv.host, srv.port);
    srv.lastPlayers = players;

    if (!online) {
      await interaction.editReply({ embeds: [buildEmbed(srv.name, srv.host, srv.port, false, 0, 0, [])] });
      return;
    }

    const timeStr = new Date().toUTCString().replace('GMT', 'UTC');
    const playerList = players.length > 0
      ? players.map(p => `• ${p}`).join('\n')
      : '_No player names available from this server_';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`👥  ${srv.name} — Players Online`)
      .addFields(
        { name: 'Count', value: `${playersOnline} / ${playersMax}`, inline: true },
        { name: 'Players', value: playerList, inline: false },
      )
      .setFooter({ text: `Checked at ${timeStr}` });

    await interaction.editReply({ embeds: [embed] });
    console.log(`[${new Date().toISOString()}] /players for ${srv.name}`);
  }
});

client.login(TOKEN);
