require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const express = require('express');
const cron = require('node-cron');

// ==================== 設定區 ====================
const BOSSES = [
  { id: 'papulatus', name: '拉圖斯', emoji: '⏰', channel: '拉圖斯參團頻道' },
  {
    id: 'hard_papulatus',
    name: '困難拉圖斯',
    emoji: '⏰',
    channel: '困難拉圖斯參團頻道',
  },
  { id: 'zakum', name: '殘暴炎魔', emoji: '🔥', channel: '殘暴炎魔參團頻道' },
  {
    id: 'horntail',
    name: '暗黑龍王',
    emoji: '🐲',
    channel: '暗黑龍王參團頻道',
  },
  { id: 'ephenia', name: '艾畢奈雅', emoji: '🧚', channel: '艾畢奈雅參團頻道' },
];

const JOBS = [
  '聖騎士',
  '黑騎士',
  '英雄',
  '神射手',
  '箭神',
  '拳霸',
  '槍神',
  '冰雷大魔導士',
  '火毒大魔導士',
  '主教',
  '夜使者',
  '暗影堔偷',
];

const REPLY_DELETE_SECONDS = 8;
// ================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const raidMessageMap = {};
const pinnedMessageMap = {};
const raidData = {};

// ==================== Keep-alive server ====================
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Keep-alive server running on port ${PORT}`),
);

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(
  () => {
    fetch(SELF_URL).catch(() => {});
  },
  14 * 60 * 1000,
);
// ===========================================================

// ==================== 註冊指令 ====================
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('在此頻道發送 BOSS 報名面板'),
    new SlashCommandBuilder()
      .setName('pin')
      .setDescription('設定此頻道的置底訊息')
      .addStringOption((option) =>
        option
          .setName('content')
          .setDescription('置底訊息內容')
          .setRequired(true),
      ),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: commands,
  });
  console.log('Slash commands registered');

  // 每週四 00:00 移除所有 BOSS 身分組
  cron.schedule(
    '0 0 * * 4',
    async () => {
      console.log('週四重置：移除所有 BOSS 身分組');
      for (const guild of client.guilds.cache.values()) {
        for (const boss of BOSSES) {
          const role = guild.roles.cache.find((r) => r.name === boss.name);
          if (!role) continue;
          const members = await guild.members.fetch();
          for (const member of members.values()) {
            if (member.roles.cache.has(role.id)) {
              await member.roles.remove(role).catch(() => {});
            }
          }
        }
      }
    },
    { timezone: 'Asia/Taipei' },
  );
});

// ==================== 指令處理 ====================
client.on('interactionCreate', async (interaction) => {
  // /setup
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
    const rows = [];
    for (let i = 0; i < BOSSES.length; i += 5) {
      const row = new ActionRowBuilder();
      BOSSES.slice(i, i + 5).forEach((boss) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`select_boss_${boss.id}`)
            .setLabel(`${boss.emoji} ${boss.name}`)
            .setStyle(ButtonStyle.Primary),
        );
      });
      rows.push(row);
    }

    const embed = new EmbedBuilder()
      .setTitle('⚔️ BOSS 遠征報名')
      .setDescription('選擇你要參加的 BOSS 遠征團')
      .setColor(0x5865f2);

    await interaction.reply({ embeds: [embed], components: rows });
    return;
  }

  // /pin
  if (interaction.isChatInputCommand() && interaction.commandName === 'pin') {
    const content = interaction.options.getString('content');
    const channel = interaction.channel;

    if (pinnedMessageMap[channel.id]) {
      const old = await channel.messages
        .fetch(pinnedMessageMap[channel.id].messageId)
        .catch(() => null);
      if (old) await old.delete().catch(() => {});
    }

    const sent = await channel.send(content);
    pinnedMessageMap[channel.id] = { messageId: sent.id, content };

    await interaction.reply({ content: '✅ 置底訊息已設定', ephemeral: true });
    return;
  }

  // BOSS 按鈕 → 職業選單
  if (
    interaction.isButton() &&
    interaction.customId.startsWith('select_boss_')
  ) {
    const bossId = interaction.customId.replace('select_boss_', '');
    const boss = BOSSES.find((b) => b.id === bossId);

    const jobSelect = new StringSelectMenuBuilder()
      .setCustomId(`select_job_${bossId}`)
      .setPlaceholder('選擇你的職業')
      .addOptions(JOBS.map((job) => ({ label: job, value: job })));

    const row = new ActionRowBuilder().addComponents(jobSelect);

    await interaction.reply({
      content: `${boss.emoji} **${boss.name}** 遠征 — 請先選擇職業：`,
      components: [row],
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 30 * 1000);
    return;
  }

  // 職業選單 → Modal
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith('select_job_')
  ) {
    const bossId = interaction.customId.replace('select_job_', '');
    const selectedJob = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`register_${bossId}_${selectedJob}`)
      .setTitle('填寫報名資料');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('char_name')
          .setLabel('角色名稱')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('char_level')
          .setLabel('等級')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  // Modal 送出
  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith('register_')
  ) {
    const withoutPrefix = interaction.customId.replace('register_', '');
    const separatorIndex = withoutPrefix.lastIndexOf('_');
    const bossId = withoutPrefix.substring(0, separatorIndex);
    const job = withoutPrefix.substring(separatorIndex + 1);
    const boss = BOSSES.find((b) => b.id === bossId);

    const charName = interaction.fields.getTextInputValue('char_name');
    const charLevel = interaction.fields.getTextInputValue('char_level');

    if (!/^\d+$/.test(charLevel)) {
      await interaction.reply({
        content: '❌ 等級只能輸入數字，請重新報名。',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;

    let role = guild.roles.cache.find((r) => r.name === boss.name);
    if (!role) {
      role = await guild.roles.create({
        name: boss.name,
        reason: 'BOSS 遠征身分組',
      });
    }
    await interaction.member.roles.add(role);

    const raidChannel = guild.channels.cache.find(
      (c) => c.name === boss.channel,
    );

    if (raidChannel) {
      const result = await updateRaidMessage(raidChannel, boss, {
        charName,
        charLevel,
        job,
        userId: interaction.user.id,
      });

      if (result?.duplicate) {
        await interaction.reply({
          content: `❌ 角色 **${charName}** 已經報名過 **${boss.name}** 遠征團了。`,
          ephemeral: true,
        });
        return;
      }
    }

    await interaction.reply({
      content: `✅ 報名成功！已加入 **${boss.name}** 遠征團\n角色：${charName} / ${charLevel} / ${job}`,
      ephemeral: true,
    });
    setTimeout(
      () => interaction.deleteReply().catch(() => {}),
      REPLY_DELETE_SECONDS * 1000,
    );
    return;
  }
});

// ==================== 置底訊息監聽 ====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const pinned = pinnedMessageMap[message.channelId];
  if (!pinned) return;
  if (message.id === pinned.messageId) return;

  const old = await message.channel.messages
    .fetch(pinned.messageId)
    .catch(() => null);
  if (old) await old.delete().catch(() => {});

  const sent = await message.channel.send(pinned.content);
  pinnedMessageMap[message.channelId].messageId = sent.id;
});

// ==================== 名單訊息管理 ====================
async function updateRaidMessage(channel, boss, newEntry) {
  if (!raidData[boss.id]) raidData[boss.id] = [];

  const existingIndex = raidData[boss.id].findIndex(
    (e) => e.charName === newEntry.charName,
  );
  if (existingIndex >= 0) return { duplicate: true };

  raidData[boss.id].push(newEntry);

  const list = raidData[boss.id]
    .map((e, i) => `${i + 1}. ${e.charName} / ${e.charLevel} / ${e.job}`)
    .join('\n');

  const content = `**${boss.emoji} ${boss.name} 遠征團**\n參團者名單\n\n${list}`;

  // 刪舊的，重發（置底效果）
  if (raidMessageMap[channel.id]) {
    const old = await channel.messages
      .fetch(raidMessageMap[channel.id])
      .catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const sent = await channel.send(content);
  raidMessageMap[channel.id] = sent.id;
  return {};
}

client.login(process.env.TOKEN);
