require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
let userSessions = {};

function initSession(userId) {
  userSessions[userId] = {
    step: 'choose_service',
    data: {
      services: [],
      social: [],
    },
  };
}

function sendMainMenu(ctx) {
  return ctx.reply(
    `👋 Welcome to *rep.digital*!

We specialize in:
❌ Removing negative content
🌟 Building strong online reputations
📢 Running ads that convert
🎯 And more...

👇 Select an option to get started or type /menu to return here anytime.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('❌ Remove Negative Content', 'remove'),
          Markup.button.callback('🌟 Build Positive Reputation', 'build'),
        ],
        [
          Markup.button.callback('📢 Ad Services', 'ads'),
          Markup.button.callback('✅ Both', 'both'),
        ],
        [Markup.button.callback('🎯 Other', 'other')],
      ]),
    }
  );
}

bot.start((ctx) => {
  initSession(ctx.from.id);
  sendMainMenu(ctx);
});

bot.command('menu', (ctx) => {
  initSession(ctx.from.id);
  sendMainMenu(ctx);
});

bot.action(['remove', 'build', 'ads', 'both', 'other'], async (ctx) => {
  const userId = ctx.from.id;
  initSession(userId);
  const choice = ctx.match[0];

  userSessions[userId].data.services =
    choice === 'both' ? ['remove', 'build'] : [choice];
  userSessions[userId].step = 'name';

  await ctx.answerCbQuery();
  await ctx.editMessageText('Great! What’s your full name?');
});
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  if (!userSessions[userId]) initSession(userId);

  const session = userSessions[userId];
  const { step } = session;
  const text = ctx.message.text;

  switch (step) {
    case 'name':
      session.data.name = text;
      session.step = 'email';
      return ctx.reply('Thanks! What’s your email address?');

    case 'email':
      session.data.email = text;
      session.step = 'phone';
      return ctx.reply('And your phone number?');

    case 'phone':
      session.data.phone = text;
      session.step = 'company';
      return ctx.reply('What’s your company name?');

    case 'company':
      session.data.company = text;

      if (session.data.services.includes('build')) {
        session.step = 'social_prompt';
        return sendSocialPlatformButtons(ctx);
      } else if (session.data.services.includes('ads')) {
        session.step = 'ad_platforms';
        return ctx.reply('What ad platforms are you interested in? (e.g. Facebook, Google)');
      } else if (session.data.services.includes('other')) {
        session.step = 'custom_request';
        return ctx.reply('Tell us briefly what you’re looking for:');
      } else {
        session.step = 'links';
        return ctx.reply('Any relevant links (e.g. reviews or articles) you want us to check?');
      }

    case 'social_prompt':
      if (text === '✅ No more links') {
        session.step = 'links';
        return ctx.reply('Any other relevant links we should check?');
      }
      session.lastSocial = text;
      session.step = 'social_link';
      return ctx.reply(`Please send the link for your ${text} profile:`);

    case 'social_link':
      session.data.social.push({ platform: session.lastSocial, link: text });
      session.step = 'social_prompt';
      return sendSocialPlatformButtons(ctx);

    case 'ad_platforms':
      session.data.ad_platforms = text;
      session.step = 'ad_account';
      return ctx.reply('Do you have an ad account or business manager set up? (Yes / No)');

    case 'ad_account':
      session.data.ad_account = text;
      if (text.toLowerCase() === 'yes') {
        session.step = 'ad_account_id';
        return ctx.reply('Please provide your Ad Account ID:');
      } else {
        session.step = 'ad_budget';
        return ctx.reply('What’s your monthly ad budget?');
      }

    case 'ad_account_id':
      session.data.ad_account_id = text;
      session.step = 'ad_budget';
      return ctx.reply('What’s your monthly ad budget?');

    case 'ad_budget':
      session.data.ad_budget = text;
      session.step = 'ad_creatives';
      return ctx.reply('Do you have creatives ready? (images, videos, ad copy)');

    case 'ad_creatives':
      session.data.ad_creatives = text;
      session.step = 'ad_goal';
      return ctx.reply('What’s your primary goal with ads? (e.g. leads, conversions)');

    case 'ad_goal':
      session.data.ad_goal = text;
      session.step = 'links';
      return ctx.reply('Any relevant links (e.g. landing pages or past ads) you’d like to share?');

    case 'custom_request':
      session.data.customRequest = text;
      session.step = 'links';
      return ctx.reply('Got it. Any links we should check? If not, just type "No".');

    case 'links':
      session.data.links = text;
      session.step = 'consent';
      return ctx.reply('Can we contact you using the info provided? Reply YES to continue.');

    default:
      return ctx.reply('I didn’t catch that. Please type /start to begin again.');
  }
});

function sendSocialPlatformButtons(ctx) {
  return ctx.reply(
    'Which platform would you like us to build on?',
    Markup.keyboard([
      ['Facebook', 'Instagram'],
      ['LinkedIn', 'Website/Other'],
      ['✅ No more links'],
    ])
      .oneTime()
      .resize()
  );
}
bot.hears(/^yes$/i, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  if (!session || session.step !== 'consent') return;

  const data = session.data;
  data.consent = 'yes';

  try {
    await sendToGHL(data);
  } catch (err) {
    await logToTelegramChannel(data, false, 'GHL sync failed');
  }

  try {
    await logToGoogleSheet(data);
  } catch (err) {
    await logToTelegramChannel(data, false, 'Google Sheet log failed');
  }

  try {
    await logToTelegramChannel(data, true);
  } catch (err) {
    console.error('Logging to Telegram failed:', err.message);
  }

  const summary = buildSummary(data);
  delete userSessions[userId];
  return ctx.reply(summary, { parse_mode: 'Markdown' });
});

function buildSummary(data) {
  const services = data.services.join(', ');
  const socials = data.social.map(s => `  - ${s.platform}: ${s.link}`).join('\n');
  return `✅ Thanks, ${data.name}!

Here’s what we received:
- Services: ${services}
- Company: ${data.company}
- Email: ${data.email}
- Phone: ${data.phone}
${data.social.length ? `- Socials:\n${socials}` : ''}
${data.ad_platforms ? `- Ad Platforms: ${data.ad_platforms}` : ''}
${data.ad_account ? `- Ad Account Setup: ${data.ad_account}` : ''}
${data.ad_account_id ? `- Ad Account ID: ${data.ad_account_id}` : ''}
${data.ad_budget ? `- Ad Budget: ${data.ad_budget}` : ''}
${data.ad_creatives ? `- Creatives Ready: ${data.ad_creatives}` : ''}
${data.ad_goal ? `- Ad Goal: ${data.ad_goal}` : ''}
${data.customRequest ? `- Other Request: ${data.customRequest}` : ''}
- Links: ${data.links || 'None'}

📅 Book your call here: ${process.env.GHL_CALENDAR_LINK}`;
}
async function sendToGHL(data) {
  try {
    const { name, email, phone, company, services = [] } = data;

    const searchResponse = await axios.get(
      `https://rest.gohighlevel.com/v1/contacts/lookup?email=${encodeURIComponent(email)}`,
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
      email,
      phone,
      firstName: name.split(' ')[0],
      lastName: name.split(' ')[1] || '',
      companyName: company || '',
      source: 'Telegram Bot',
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

    // Add source tag
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

    // Add a contact note
    const noteLines = [
      `Source: Telegram Bot`,
      `Name: ${name}`,
      `Company: ${company}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Services: ${services.join(', ')}`,
    ];

    if (data.social?.length) {
      noteLines.push('Socials:');
      noteLines.push(...data.social.map(s => `- ${s.platform}: ${s.link}`));
    }

    if (data.ad_platforms) noteLines.push(`Ad Platforms: ${data.ad_platforms}`);
    if (data.ad_account) noteLines.push(`Ad Account: ${data.ad_account}`);
    if (data.ad_account_id) noteLines.push(`Ad Account ID: ${data.ad_account_id}`);
    if (data.ad_budget) noteLines.push(`Ad Budget: ${data.ad_budget}`);
    if (data.ad_creatives) noteLines.push(`Ad Creatives: ${data.ad_creatives}`);
    if (data.ad_goal) noteLines.push(`Ad Goal: ${data.ad_goal}`);
    if (data.customRequest) noteLines.push(`Custom Request: ${data.customRequest}`);
    if (data.links) noteLines.push(`Links: ${data.links}`);
    noteLines.push(`Consent: Yes`);

    await axios.post(
      `https://rest.gohighlevel.com/v1/contacts/${contactId}/notes`,
      { body: noteLines.join('\n') },
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    console.error('❌ GHL Error:', err.response?.data || err.message);
    throw err;
  }
}

async function logToGoogleSheet(data) {
  try {
    const payload = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company || '',
      services: data.services?.join(', ') || '',
      socialLinks: data.social?.map(s => `${s.platform}: ${s.link}`).join('; ') || '',
      links: data.links || '',
      ad_platforms: data.ad_platforms || '',
      ad_account: data.ad_account || '',
      ad_account_id: data.ad_account_id || '',
      ad_budget: data.ad_budget || '',
      ad_creatives: data.ad_creatives || '',
      ad_goal: data.ad_goal || '',
      customRequest: data.customRequest || '',
      consent: 'yes',
      timestamp: new Date().toISOString(),
    };

    await axios.post(process.env.SHEETS_WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('❌ Google Sheets Error:', err.message);
    throw err;
  }
}

async function logToTelegramChannel(data, success = true, failureReason = '') {
  try {
    const status = success ? '✅ Successful Submission' : `❌ Failed Submission (${failureReason})`;
    const socials = data.social?.map(s => `- ${s.platform}: ${s.link}`).join('\n') || 'None';

    const msg = `${status}:

Name: ${data.name}
Company: ${data.company}
Email: ${data.email}
Phone: ${data.phone}
Services: ${data.services?.join(', ') || 'None'}
Socials:\n${socials}
${data.ad_platforms ? `Ad Platforms: ${data.ad_platforms}` : ''}
${data.ad_account ? `Ad Account: ${data.ad_account}` : ''}
${data.ad_account_id ? `Ad Account ID: ${data.ad_account_id}` : ''}
${data.ad_budget ? `Budget: ${data.ad_budget}` : ''}
${data.ad_creatives ? `Creatives: ${data.ad_creatives}` : ''}
${data.ad_goal ? `Goal: ${data.ad_goal}` : ''}
${data.customRequest ? `Other Notes: ${data.customRequest}` : ''}
Links: ${data.links || 'None'}
Consent: Yes
Timestamp: ${new Date().toLocaleString()}`;

    await bot.telegram.sendMessage(process.env.TELEGRAM_CHANNEL_ID, msg);
  } catch (err) {
    console.error('❌ Telegram Logging Error:', err.message);
  }
}
// Set /menu command for easy access
bot.telegram.setMyCommands([
  { command: 'menu', description: 'Return to the main service selection menu' },
]);

// Launch the bot
bot.launch().then(() => {
  console.log('🚀 Telegram bot is up and running!');
});

// Graceful shutdown handlers
process.once('SIGINT', () => {
  console.log('🔻 SIGINT received. Stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🔻 SIGTERM received. Stopping bot...');
  bot.stop('SIGTERM');
});
