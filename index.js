// index.js (updated for natural flow, social buttons, and link submissions)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GHL_CALENDAR_LINK = process.env.GHL_CALENDAR_LINK;
const userSessions = {};

function delay(ctx, ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  userSessions[chatId] = {};

  await ctx.replyWithChatAction('typing');
  await delay(ctx, 800);

  await ctx.reply(
    `Hey there! 👋 Welcome to *rep.digital*.\n\nWe specialize in removing negative content and building powerful online reputations. What would you like help with today?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Remove Negative Content', 'remove')],
      [Markup.button.callback('🌟 Build Positive Reputation', 'build')],
    ]),
    { parse_mode: 'Markdown' }
  );
});

bot.action(['remove', 'build'], async (ctx) => {
  const chatId = ctx.chat.id;
  userSessions[chatId].service = ctx.match.input;
  userSessions[chatId].step = 'name';

await ctx.editMessageText('Awesome! I can help with that. First things first — what’s your full name?');
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = userSessions[chatId];
  if (!session || !session.step) return ctx.reply('Please start by typing /start');

  const text = ctx.message.text;

  switch (session.step) {
    case 'name':
      session.name = text;
      session.step = 'company';
      await ctx.replyWithChatAction('typing');
      await delay(ctx, 700);
      return ctx.reply(`Nice to meet you, ${text.split(' ')[0]}! 👋 What’s your company name?`);

    case 'company':
      session.company = text;
      session.step = 'email';
      return ctx.reply('Got it. What’s your email address?');

    case 'email':
      session.email = text;
      session.step = 'phone';
      return ctx.reply('And your phone number?');

    case 'phone':
      session.phone = text;
      session.step = 'social';
      return ctx.reply('Which social profile would you like to share?',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Facebook', 'social_facebook'),
            Markup.button.callback('Instagram', 'social_instagram')
          ],
          [
            Markup.button.callback('LinkedIn', 'social_linkedin'),
            Markup.button.callback('Website / Other', 'social_other')
          ]
        ])
      );

    case 'website':
      session.websites = text;
      session.step = 'confirm';

      const summary = `✅ Here’s what we have:

- Name: ${session.name}
- Company: ${session.company}
- Email: ${session.email}
- Phone: ${session.phone}
- Social Links: ${session.socialLinks?.join(', ') || 'None'}
- URLs to Remove: ${session.websites || 'None'}
- Service: ${session.service === 'remove' ? 'Remove Negative Content' : 'Build Positive Reputation'}

Would you like to mark this as URGENT? ⚠️`;

      return ctx.reply(summary, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Submit', 'submit')],
        [Markup.button.callback('⚠️ Mark as URGENT', 'urgent')]
      ]));

    default:
      return ctx.reply('Something went wrong. Please type /start to begin again.');
  }
});

bot.action(['social_facebook', 'social_instagram', 'social_linkedin', 'social_other'], async (ctx) => {
  const chatId = ctx.chat.id;
  const platform = ctx.match.input.replace('social_', '');
  userSessions[chatId].currentPlatform = platform;
  userSessions[chatId].step = 'addSocial';
  return ctx.reply(`Please send the link to your ${platform === 'other' ? 'website or other profile' : platform} account:`);
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = userSessions[chatId];

  if (session.step === 'addSocial') {
    if (!session.socialLinks) session.socialLinks = [];
    session.socialLinks.push(ctx.message.text);
    session.step = 'addMoreSocial';
    return ctx.reply('Would you like to add another social profile?',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Yes', 'add_more_social'),
          Markup.button.callback('No', 'skip_social')
        ]
      ])
    );
  }
});

bot.action('add_more_social', async (ctx) => {
  userSessions[ctx.chat.id].step = 'social';
  return ctx.reply('Select another social profile to add:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Facebook', 'social_facebook'), Markup.button.callback('Instagram', 'social_instagram')],
      [Markup.button.callback('LinkedIn', 'social_linkedin'), Markup.button.callback('Website / Other', 'social_other')]
    ])
  );
});

bot.action('skip_social', async (ctx) => {
  userSessions[ctx.chat.id].step = 'website';
  return ctx.reply('Please send any specific links (URLs) you’d like us to review or remove.');
});

bot.action(['submit', 'urgent'], async (ctx) => {
  const chatId = ctx.chat.id;
  const session = userSessions[chatId];

  if (ctx.match.input === 'urgent') {
    session.urgent = true;
  }

  await ctx.reply('Awesome! We’re logging your details now...');

  await sendToGHL(session);

  delete userSessions[chatId];
  return ctx.reply(`✅ You're all set! Book a call with our team here:
${GHL_CALENDAR_LINK}`);
});

async function sendToGHL(data) {
  try {
    const { name, email, phone, company, socialLinks, service, websites, urgent } = data;

    const searchResponse = await axios.get(
      `https://rest.gohighlevel.com/v1/contacts/lookup?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}` } }
    );

    const existing = searchResponse.data?.contact;
    let contactId;

    if (existing) {
      contactId = existing.id;
      await axios.put(`https://rest.gohighlevel.com/v1/contacts/${contactId}`, {
        email,
        phone,
        firstName: name.split(' ')[0],
        lastName: name.split(' ')[1] || '',
        companyName: company,
      }, {
        headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}` }
      });
    } else {
      const createResponse = await axios.post(`https://rest.gohighlevel.com/v1/contacts/`, {
        locationId: process.env.GHL_LOCATION_ID,
        email,
        phone,
        firstName: name.split(' ')[0],
        lastName: name.split(' ')[1] || '',
        companyName: company,
        source: 'Telegram Bot'
      }, {
        headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}` }
      });
      contactId = createResponse.data.id;
    }

    await axios.post(`https://rest.gohighlevel.com/v1/contacts/${contactId}/tags`, {
      tags: ['telegram lead']
    }, {
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}` }
    });

    const note = `Source: Telegram Bot${urgent ? ' (URGENT)' : ''}
Service: ${service === 'remove' ? 'Remove Negative Content' : 'Build Positive Reputation'}
Name: ${name}
Company: ${company}
Email: ${email}
Phone: ${phone}
Socials: ${socialLinks?.join(', ') || 'None'}
URLs: ${websites || 'None'}`;

    await axios.post(`https://rest.gohighlevel.com/v1/contacts/${contactId}/notes`, {
      body: note
    }, {
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}` }
    });

  } catch (err) {
    console.error('❌ GHL Sync Error:', err.response?.data || err.message);
  }
}
// Trigger redeploy - no code change

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

