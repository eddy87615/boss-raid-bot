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

const RAID_CHANNEL_PREFIX = 'raid-';
// 報名訊息幾秒後消失（ephemeral 回覆）
const REPLY_DELETE_SECONDS = 8;
// ================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

// 儲存每個頻道的名單訊息 ID { channelId: messageId }
const raidMessageMap = {};

// ==================== Keep-alive server ====================
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Keep-alive server running on port ${PORT}`),
);

// 每 14 分鐘 ping 自己（防 Render 休眠）
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
  // /setup 指令 → 發送報名面板
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
    const rows = [];
    // 每行最多 5 個按鈕
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

  // 按下 BOSS 按鈕 → 跳出職業選單
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
    return;
  }

  // 選完職業 → 跳出 Modal
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith('select_job_')
  ) {
    const bossId = interaction.customId.replace('select_job_', '');
    const selectedJob = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`register_${bossId}_${selectedJob}`)
      .setTitle('填寫報名資料');

    const nameInput = new TextInputBuilder()
      .setCustomId('char_name')
      .setLabel('角色名稱')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const levelInput = new TextInputBuilder()
      .setCustomId('char_level')
      .setLabel('等級')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(levelInput),
    );

    await interaction.showModal(modal);
    return;
  }

  // Modal 送出 → 指派身分組 + 更新名單
  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith('register_')
  ) {
    const parts = interaction.customId.split('_');
    // register_{bossId}_{job} → parts[1] = bossId, parts[2..] = job（職業名可能有底線）
    const bossId = parts[1];
    const job = parts.slice(2).join('_');
    const boss = BOSSES.find((b) => b.id === bossId);

    const charName = interaction.fields.getTextInputValue('char_name');
    const charLevel = interaction.fields.getTextInputValue('char_level');
    const guild = interaction.guild;

    // 找或建立身分組
    let role = guild.roles.cache.find((r) => r.name === boss.name);
    if (!role) {
      role = await guild.roles.create({
        name: boss.name,
        reason: 'BOSS 遠征身分組',
      });
    }
    await interaction.member.roles.add(role);

    // 找對應頻道
    const channelName = boss.channel;
    const raidChannel = guild.channels.cache.find(
      (c) => c.name === channelName,
    );

    if (raidChannel) {
      await updateRaidMessage(raidChannel, boss, {
        charName,
        charLevel,
        job,
        userId: interaction.user.id,
      });
    }

    await interaction.reply({
      content: `✅ 報名成功！已加入 **${boss.name}** 遠征團\n角色：${charName} / ${charLevel} / ${job}`,
      ephemeral: true,
    });

    // 幾秒後刪除 ephemeral 回覆
    setTimeout(
      () => interaction.deleteReply().catch(() => {}),
      REPLY_DELETE_SECONDS * 1000,
    );
    return;
  }
});

// ==================== 名單訊息管理 ====================
// 儲存每個 boss 頻道的報名資料 { bossId: [ { charName, charLevel, job, userId } ] }
const raidData = {};

async function updateRaidMessage(channel, boss, newEntry) {
  if (!raidData[boss.id]) raidData[boss.id] = [];

  // 同一個 userId 重複報名 → 更新資料
  const existingIndex = raidData[boss.id].findIndex(
    (e) => e.userId === newEntry.userId,
  );
  if (existingIndex >= 0) {
    raidData[boss.id][existingIndex] = newEntry;
  } else {
    raidData[boss.id].push(newEntry);
  }

  const list = raidData[boss.id]
    .map((e, i) => `${i + 1}. ${e.charName} / ${e.charLevel} / ${e.job}`)
    .join('\n');

  const content = `**${boss.emoji} ${boss.name} 遠征團**\n參團者名單\n\n${list}`;

  // 更新或發送新訊息
  if (raidMessageMap[channel.id]) {
    const msg = await channel.messages
      .fetch(raidMessageMap[channel.id])
      .catch(() => null);
    if (msg) {
      await msg.edit(content);
      return;
    }
  }

  const sent = await channel.send(content);
  raidMessageMap[channel.id] = sent.id;
}
// ======================================================

client.login(process.env.TOKEN);
