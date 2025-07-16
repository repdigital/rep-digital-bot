// index.js (updated with GHL API integration)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GHL_CALENDAR_LINK = process.env.GHL_CALENDAR_LINK;

const userSessions = {};

bot.start((ctx) => {
  ctx.reply(
    `Welcome to rep.digital 👋\n\nWe remove negative content from the internet and help build powerful online reputations.\nWhat would you like help with today?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Remove Negative Content', 'remove')],
      [Markup.button.callback('🌟 Build Positive Reputation', 'build')],
    ])
  );
});

bot.action(['remove', 'build'], async (ctx) => {
  const chatId = ctx.chat.id;
  userSessions[chatId] = { service: ctx.match.input };
  await ctx.editMessageText('Got it. What’s your full name?');
  userSessions[chatId].step = 'name';
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = userSessions[chatId];
  if (!session || !session.step) return ctx.reply('Please start with /start');

  const text = ctx.message.text;

  switch (session.step) {
    case 'name':
      session.name = text;
      session.step = 'company';
      return ctx.reply('What’s your company name?');

    case 'company':
      session.company = text;
      session.step = 'email';
      return ctx.reply('Your email address?');

    case 'email':
      session.email = text;
      session.step = 'phone';
      return ctx.reply('Phone number?');

    case 'phone':
      session.phone = text;
      session.step = 'social';
      return ctx.reply('Any relevant social media links?');

    case 'social':
      session.social = text;

      // Send to GHL
      await sendToGHL(session);

      const reply = `✅ Thanks, ${session.name}!\n\nHere’s what we have:\n\n` +
        `- Service: ${session.service === 'remove' ? 'Remove Negative Content' : 'Build Positive Reputation'}\n` +
        `- Company: ${session.company}\n- Email: ${session.email}\n- Phone: ${session.phone}\n- Social: ${session.social}\n\n` +
        `📅 Book your call here: ${GHL_CALENDAR_LINK}`;

      delete userSessions[chatId];
      return ctx.reply(reply);

    default:
      return ctx.reply('Something went wrong. Type /start to begin again.');
  }
});

async function sendToGHL(data) {
  try {
    const response = await axios.post(
      'https://rest.gohighlevel.com/v1/contacts/',
      {
        locationId: process.env.GHL_LOCATION_ID,
        firstName: data.name.split(' ')[0],
        lastName: data.name.split(' ')[1] || '',
        email: data.email,
        phone: data.phone,
        customField: data.company,
        source: 'Telegram Bot'
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Contact sent to GHL:', response.data);
  } catch (error) {
    console.error('❌ Failed to send to GHL:', error.response?.data || error.message);
  }
}

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));