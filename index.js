require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
let userState = {};

bot.start((ctx) => {
  const firstName = ctx.from.first_name || 'there';
  userState[ctx.from.id] = { step: 'start' };

  ctx.reply(
    `👋 Hey ${firstName}! Welcome to *rep.digital*.\n\n` +
      `We specialize in removing negative content, building strong reputations, running effective ads, and helping you win online.\n\n` +
      `👇 Choose a service to get started or type /menu at any time to return here.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('❌ Remove Negative Content', 'remove_content'),
          Markup.button.callback('🌟 Build Positive Reputation', 'build_reputation')
        ],
        [
          Markup.button.callback('📢 Ad Platform / Marketing Services', 'ads_services')
        ],
        [
          Markup.button.callback('✅ Both', 'both'),
          Markup.button.callback('🎯 Other', 'other')
        ]
      ])
    }
  );
});

bot.command('menu', (ctx) => {
  userState[ctx.from.id] = { step: 'start' };
  ctx.reply(
    `🔁 Main Menu\n\nPlease choose a service:`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('❌ Negative Content Removal', 'remove_content'),
        Markup.button.callback('🌟 Positive Content Generation', 'build_reputation')
      ],
      [
        Markup.button.callback('📢 Ad Platform / Marketing Services', 'ads_services')
      ],
      [
        Markup.button.callback('✅ Both', 'both'),
        Markup.button.callback('🎯 Other', 'other')
      ]
    ])
  );
});
// Handle service selections
bot.action(['remove_content', 'build_reputation', 'ads_services', 'both', 'other'], async (ctx) => {
  const chatId = ctx.from.id;
  const selection = ctx.match.input;

  userState[chatId] = {
    step: 'name',
    services: [],
    data: {},
  };

  switch (selection) {
    case 'remove_content':
      userState[chatId].services = ['remove'];
      break;
    case 'build_reputation':
      userState[chatId].services = ['build'];
      break;
    case 'ads_services':
      userState[chatId].services = ['ads'];
      break;
    case 'both':
      userState[chatId].services = ['remove', 'build'];
      break;
    case 'other':
      userState[chatId].services = ['other'];
      userState[chatId].step = 'custom_query';
      return ctx.reply('✏️ Please describe what you’re looking for so we can tailor our support:');
  }

  await ctx.reply('👤 What is your full name? This helps us address you properly.');
});

// Generic message handler
bot.on('text', async (ctx) => {
  const chatId = ctx.from.id;
  const session = userState[chatId];

  if (!session || !session.step) {
    return ctx.reply('Please type /start or /menu to begin.');
  }

  const text = ctx.message.text.trim();

  switch (session.step) {
    case 'name':
      session.data.name = text;
      session.step = 'company';
      return ctx.reply('🏢 What is your company name?');
    case 'company':
      session.data.company = text;
      session.step = 'email';
      return ctx.reply('📧 What is your email address?');

    case 'email':
      session.data.email = text;
      session.step = 'phone';
      return ctx.reply('📞 What is your phone number?');

    case 'phone':
      session.data.phone = text;

      if (session.services.includes('ads')) {
        session.step = 'ad_platforms';
        return ctx.reply('📢 What platforms are you interested in running ads on?\n_Example: Meta (Facebook/Instagram), Google, TikTok, LinkedIn, YouTube, etc._');
      }

      if (session.services.includes('build')) {
        session.step = 'social';
        return ctx.reply('🔗 Let’s collect links to your social profiles. What platform would you like to start with?\n(Options: Facebook, Instagram, LinkedIn, Website/Other)');
      }

      if (session.services.includes('remove')) {
        session.step = 'links';
        return ctx.reply('🔗 Please provide the URLs to any content you’d like removed.');
      }

      if (session.services.includes('other')) {
        session.step = 'custom_query';
        return ctx.reply('✏️ Please describe what you’re looking for.');
      }

      return ctx.reply('✅ Almost done! Please type /menu to restart or continue.');
    
    case 'ad_platforms':
      session.data.ad_platforms = text;
      session.step = 'ad_account';
      return ctx.reply('🧾 Do you already have an ad account or business manager set up? (Yes / No)');
    
    case 'ad_account':
      session.data.ad_account = text;
      if (text.toLowerCase() === 'yes') {
        session.step = 'ad_account_id';
        return ctx.reply('🔢 Please provide the Ad Account ID (if available):');
      } else {
        session.step = 'ad_budget';
        return ctx.reply('💸 What is your monthly ad budget? Even a ballpark is helpful.');
      }

    case 'ad_account_id':
      session.data.ad_account_id = text;
      session.step = 'ad_budget';
      return ctx.reply('💸 What is your monthly ad budget? Even a ballpark is helpful.');
    
    case 'ad_budget':
      session.data.ad_budget = text;
      session.step = 'ad_creatives';
      return ctx.reply('🎨 Do you have any creatives ready (images, videos, ad copy)? (Yes / No)');

    case 'ad_creatives':
      session.data.ad_creatives = text;
      session.step = 'ad_goal';
      return ctx.reply('🎯 What’s your primary goal with ads?\n_Lead generation, sales, brand awareness, etc._');
    
    case 'ad_goal':
      session.data.ad_goal = text;
      session.step = 'links';
      return ctx.reply('🔗 Any landing pages, sales pages, or current ad links we should review? Drop them here:');
    case 'links':
      session.data.links = text;
      session.step = 'consent';
      return ctx.reply('✅ Got it! One last thing — can we contact you using the info you’ve provided (email/phone)?\nPlease reply YES to continue.');

    case 'custom_query':
      session.data.custom_query = text;
      session.step = 'consent';
      return ctx.reply('✅ Got it! One last thing — can we contact you using the info you’ve provided (email/phone)?\nPlease reply YES to continue.');

    case 'consent':
      if (text.trim().toLowerCase() !== 'yes') {
        return ctx.reply('⚠️ We need your consent to proceed. Please reply YES to continue.');
      }

      session.data.consent = 'yes';

      // Send to GHL
      await sendToGHL(chatId);

      // Log to Google Sheet
      await logToGoogleSheet(chatId);

      const summary = buildSummaryMessage(session);

      await ctx.reply(summary, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      await ctx.reply(`📅 Book a call here: ${GHL_CALENDAR_LINK}`);

      delete userSessions[chatId];
      return;

    default:
      return ctx.reply('❌ Something went wrong. Please type /start to begin again.');
  }
});
function buildSummaryMessage(session) {
  const data = session.data;
  const services = session.services?.join(', ') || 'N/A';

  let summary = `✅ *Submission Summary*\n\n`;
  summary += `*Name:* ${data.name}\n`;
  summary += `*Email:* ${data.email}\n`;
  summary += `*Phone:* ${data.phone}\n`;
  summary += `*Company:* ${data.company}\n`;
  summary += `*Service(s):* ${services}\n\n`;

  if (session.services.includes('remove') || session.services.includes('build') || session.services.includes('both')) {
    if (data.social && data.social.length) {
      summary += `*Social Media Links:*\n`;
      data.social.forEach((s) => {
        summary += `- ${s.platform}: ${s.link} ${s.valid ? '' : '❌ Invalid'}\n`;
      });
    }
    if (data.links) summary += `\n*Additional Links:* ${data.links}\n`;
  }

  if (session.services.includes('ads')) {
    summary += `*Ad Platforms:* ${data.ad_platforms || 'N/A'}\n`;
    summary += `*Ad Account:* ${data.ad_account || 'N/A'}\n`;
    if (data.ad_account_id) summary += `*Ad Account ID:* ${data.ad_account_id}\n`;
    summary += `*Budget:* ${data.ad_budget || 'N/A'}\n`;
    summary += `*Creatives Ready:* ${data.ad_creatives || 'N/A'}\n`;
    summary += `*Goal:* ${data.ad_goal || 'N/A'}\n`;
    if (data.links) summary += `\n*Links to Review:* ${data.links}\n`;
  }

  if (session.services.includes('other')) {
    summary += `*Custom Query:* ${data.custom_query || 'N/A'}\n`;
  }

  return summary;
}

async function sendToGHL(chatId) {
  try {
    const data = userSessions[chatId]?.data;
    if (!data) return;

    const searchResponse = await axios.get(
      `https://rest.gohighlevel.com/v1/contacts/lookup?email=${encodeURIComponent(data.email)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const existingContact = searchResponse.data?.contact;
    let contactId;

    const contactPayload = {
      email: data.email,
      phone: data.phone,
      firstName: data.name.split(' ')[0],
      lastName: data.name.split(' ')[1] || '',
      companyName: data.company,
      source: 'Telegram Bot'
    };

    if (existingContact) {
      contactId = existingContact.id;
      await axios.put(
        `https://rest.gohighlevel.com/v1/contacts/${contactId}`,
        contactPayload,
        {
          headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } else {
      const createResponse = await axios.post(
        `https://rest.gohighlevel.com/v1/contacts/`,
        { ...contactPayload, locationId: process.env.GHL_LOCATION_ID },
        {
          headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      contactId = createResponse.data.id;
    }

    await axios.post(
      `https://rest.gohighlevel.com/v1/contacts/${contactId}/tags`,
      { tags: ['telegram lead'] },
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let note = `Source: Telegram Bot\nServices: ${userSessions[chatId].services.join(', ')}\nName: ${data.name}\nCompany: ${data.company}\nEmail: ${data.email}\nPhone: ${data.phone}\n`;

    if (data.social) {
      note += `Socials:\n${data.social.map(s => `- ${s.platform}: ${s.link}${s.valid ? '' : ' ❌'}`).join('\n')}\n`;
    }
    if (data.links) note += `Links: ${data.links}\n`;

    if (userSessions[chatId].services.includes('ads')) {
      note += `Ad Platforms: ${data.ad_platforms}\nAd Account: ${data.ad_account}\n`;
      if (data.ad_account_id) note += `Ad Account ID: ${data.ad_account_id}\n`;
      note += `Ad Budget: ${data.ad_budget}\nCreatives Ready: ${data.ad_creatives}\nGoal: ${data.ad_goal}\n`;
    }

    if (userSessions[chatId].services.includes('other')) {
      note += `Custom Query: ${data.custom_query}\n`;
    }

    note += `Consent: YES`;

    await axios.post(
      `https://rest.gohighlevel.com/v1/contacts/${contactId}/notes`,
      { body: note },
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('❌ Error syncing with GHL:', error.response?.data || error.message);
  }
}

async function logToGoogleSheet(chatId) {
  try {
    const data = userSessions[chatId]?.data;
    if (!data) return;

    const payload = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      services: userSessions[chatId].services.join(', '),
      socials: data.social?.map(s => `${s.platform}: ${s.link}`).join('; ') || '',
      links: data.links || '',
      ad_platforms: data.ad_platforms || '',
      ad_account: data.ad_account || '',
      ad_account_id: data.ad_account_id || '',
      ad_budget: data.ad_budget || '',
      ad_creatives: data.ad_creatives || '',
      ad_goal: data.ad_goal || '',
      custom_query: data.custom_query || '',
      consent: 'yes',
      timestamp: new Date().toISOString(),
    };

    await axios.post(process.env.SHEETS_WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('❌ Failed to log to Google Sheets:', err.message);
  }
}

bot.telegram.setMyCommands([
  { command: 'menu', description: 'Open Main Services Menu' }
]);

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
