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

const THUMBNAIL = 'https://481fbf75-a98f-4071-8eba-fb01b7084ee1-00-1y0azzefcprq9.pike.replit.dev/api/assets/thumbnail.png';
const POLL_INTERVAL_MS = 60 * 1000;
const CONFIRM_CHECKS = 3;

function parseChannelId(raw) {
  return raw.includes('discord.com/channels/') ? raw.split('/').pop() : raw;
}

const SERVERS = [
  {
    name: 'HRX SMP',
    host: 'kHRX-3.aternos.me',
    port: 39034,
    channelId: parseChannelId(process.env.DISCORD_CHANNEL_ID ?? ''),
    thumbnail: THUMBNAIL,
    lastKnownOnline: null,
    pendingStatus: null,
    pendingCount: 0,
  },
  {
    name: 'Tiger SMP',
    host: 'Tiger_SMP_111.aternos.me',
    port: 11067,
    channelId: parseChannelId(process.env.DISCORD_CHANNEL_ID_2 ?? ''),
    thumbnail: null,
    lastKnownOnline: null,
    pendingStatus: null,
    pendingCount: 0,
  },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function getServerStatus(host, port) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await status(host, port, { timeout: 10000 });
      return { online: true, playersOnline: res.players.online, playersMax: res.players.max };
    } catch {
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return { online: false, playersOnline: 0, playersMax: 0 };
}

function buildEmbed(name, host, port, thumbnail, online, playersOnline, playersMax) {
  const timeStr = new Date().toUTCString().replace('GMT', 'UTC');
  if (online) {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`🟢  ${name}`)
      .addFields(
        { name: '📡 Status', value: 'Online', inline: true },
        { name: '👥 Players', value: `${playersOnline} / ${playersMax}`, inline: true },
        { name: '🌍 IP Address', value: `\`${host}:${port}\``, inline: false },
      )
      .setFooter({ text: `Last updated • ${timeStr}` });
    if (thumbnail) embed.setThumbnail(thumbnail);
    return embed;
  }
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`🔴  ${name}`)
    .addFields(
      { name: '📡 Status', value: 'Offline', inline: true },
      { name: '🌍 IP Address', value: `\`${host}:${port}\``, inline: false },
    )
    .setFooter({ text: `Last updated • ${timeStr}` });
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

async function checkServer(srv) {
  if (!srv.channelId) return;
  const { online, playersOnline, playersMax } = await getServerStatus(srv.host, srv.port);

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

  if (srv.pendingCount < CONFIRM_CHECKS) return;

  const wasUnknown = srv.lastKnownOnline === null;
  srv.lastKnownOnline = online;
  srv.pendingStatus = null;
  srv.pendingCount = 0;

  if (wasUnknown && !online) return;

  try {
    const channel = await client.channels.fetch(srv.channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      console.error(`Channel not found for ${srv.name}:`, srv.channelId);
      return;
    }
    const embed = buildEmbed(srv.name, srv.host, srv.port, srv.thumbnail, online, playersOnline, playersMax);
    const content = online
      ? `@everyone 🟢 **${srv.name} is now Online!** Come join!`
      : `@everyone 🔴 **${srv.name} just went Offline.**`;
    await channel.send({ content, embeds: [embed] });
    console.log(`[${new Date().toISOString()}] [${srv.name}] Sent: ${online ? 'Online' : 'Offline'}`);
  } catch (err) {
    console.error(`[${srv.name}] Failed to post:`, err.message);
  }
}

async function checkAll() {
  await Promise.all(SERVERS.map(srv => checkServer(srv)));
}

async function registerCommands(clientId) {
  const command = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the current Minecraft server status')
    .addStringOption(opt =>
      opt.setName('server')
        .setDescription('Which server to check')
        .setRequired(false)
        .addChoices(...SERVERS.map(s => ({ name: s.name, value: s.name })))
    );
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
  checkAll();
  setInterval(checkAll, POLL_INTERVAL_MS);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'status') return;
  await interaction.deferReply({ ephemeral: true });
  const chosen = interaction.options.getString('server');
  const srv = chosen ? SERVERS.find(s => s.name === chosen) : SERVERS[0];
  if (!srv) { await interaction.editReply('Server not found.'); return; }
  const { online, playersOnline, playersMax } = await getServerStatus(srv.host, srv.port);
  await interaction.editReply({ embeds: [buildEmbed(srv.name, srv.host, srv.port, srv.thumbnail, online, playersOnline, playersMax)] });
  console.log(`[${new Date().toISOString()}] Responded to /status for ${srv.name}`);
});

client.login(TOKEN);
