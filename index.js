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
      socialLinks: [],
    },
  };
}

function sendMainMenu(ctx) {
  return ctx.reply(
    `👋 Hey there! Welcome to *rep.digital*.\n\n` +
      `We specialize in removing negative content, building strong reputations, running effective ads, and helping you win online.\n\n` +
      `👇 Choose a service to get started or type /menu at any time to return here.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('❌ Remove Negative Content', 'remove'),
          Markup.button.callback('🌟 Build Positive Reputation', 'build'),
        ],
        [
          Markup.button.callback('📢 Ad Platform / Marketing Services', 'ads'),
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
  const choice = ctx.match[0];
  const session = userSessions[userId] || initSession(userId);

  session.step = 'name';
  session.data.services =
    choice === 'both' ? ['remove', 'build'] : [choice];

  await ctx.answerCbQuery();
  await ctx.editMessageText('Great! What’s your full name?');
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  if (!userSessions[userId]) initSession(userId);

  const session = userSessions[userId];
  const step = session.step;
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
        return ctx.reply(
          'Which platform do you want us to build your reputation on?',
          Markup.keyboard([
            ['Facebook', 'Instagram'],
            ['LinkedIn', 'Website/Other'],
            ['✅ No more links'],
          ])
            .oneTime()
            .resize()
        );
      } else if (session.data.services.includes('ads')) {
        session.step = 'ad_platforms';
        return ctx.reply(
          'What platforms are you interested in running ads on?\nExample: Facebook, Google, TikTok, etc.'
        );
      } else if (session.data.services.includes('other')) {
        session.step = 'custom_request';
        return ctx.reply('Tell us briefly what you’re looking for:');
      } else {
        session.step = 'links';
        return ctx.reply(
          'Do you have any relevant links (ex: negative articles, review sites, etc.) we should check?'
        );
      }
    case 'social_prompt':
      if (!session.data.social) session.data.social = [];

      if (text === '✅ No more links') {
        session.step = 'links';
        return ctx.reply('Any other relevant links we should check?');
      }

      session.lastSocial = text;
      session.step = 'social_link';
      return ctx.reply(`Please send the link for your ${text} profile:`);

    case 'social_link':
      const platform = session.lastSocial;
      const link = text;

      session.data.social.push({ platform, link });
      session.step = 'social_prompt';
      return ctx.reply(
        'Got it! Want to add another?',
        Markup.keyboard([
          ['Facebook', 'Instagram'],
          ['LinkedIn', 'Website/Other'],
          ['✅ No more links'],
        ])
          .oneTime()
          .resize()
      );

    case 'ad_platforms':
      session.data.ad_platforms = text;
      session.step = 'ad_account';
      return ctx.reply(
        'Do you already have an ad account or business manager set up? (Yes / No)'
      );

    case 'ad_account':
      session.data.ad_account = text;
      if (text.toLowerCase() === 'yes') {
        session.step = 'ad_account_id';
        return ctx.reply('Please provide your Ad Account ID (if available):');
      } else {
        session.step = 'ad_budget';
        return ctx.reply('What’s your monthly ad budget? Even a ballpark is fine.');
      }

    case 'ad_account_id':
      session.data.ad_account_id = text;
      session.step = 'ad_budget';
      return ctx.reply('What’s your monthly ad budget?');

    case 'ad_budget':
      session.data.ad_budget = text;
      session.step = 'ad_creatives';
      return ctx.reply(
        'Do you have any creatives ready to go (images, videos, or ad copy)? Yes / No'
      );

    case 'ad_creatives':
      session.data.ad_creatives = text;
      session.step = 'ad_goal';
      return ctx.reply(
        'What’s your primary goal with ads? (e.g. lead generation, conversions, etc.)'
      );

    case 'ad_goal':
      session.data.ad_goal = text;
      session.step = 'links';
      return ctx.reply(
        'Any landing pages, sales pages, or current ad links we should review?'
      );

    case 'custom_request':
      session.data.customRequest = text;
      session.step = 'links';
      return ctx.reply(
        'Got it. Do you have any links you’d like us to review? If not, just type "No".'
      );

    case 'links':
      session.data.links = text;
      session.step = 'consent';
      return ctx.reply(
        'Can we contact you using the info provided (email or phone)? Reply YES to continue.'
      );
    case 'consent':
      if (text.trim().toLowerCase() !== 'yes') {
        return ctx.reply('We need your consent to continue. Please reply YES to proceed.');
      }

      session.data.consent = 'yes';

      // Send data to GHL
      await sendToGHL(session.data);

      // Log to Google Sheets
      await logToGoogleSheet(session.data);

      // Log to Telegram channel
      await logToTelegramChannel(session.data);

      const services = session.data.services || [];
      const summary = `✅ Thanks, ${session.data.name}!

Here’s what we received:
- Services: ${services.join(', ')}
- Company: ${session.data.company}
- Email: ${session.data.email}
- Phone: ${session.data.phone}
${session.data.social ? `- Socials:\n${session.data.social.map(s => `  - ${s.platform}: ${s.link}`).join('\n')}` : ''}
${session.data.ad_platforms ? `- Ad Platforms: ${session.data.ad_platforms}` : ''}
${session.data.ad_account ? `- Ad Account Setup: ${session.data.ad_account}` : ''}
${session.data.ad_account_id ? `- Ad Account ID: ${session.data.ad_account_id}` : ''}
${session.data.ad_budget ? `- Ad Budget: ${session.data.ad_budget}` : ''}
${session.data.ad_creatives ? `- Creatives Ready: ${session.data.ad_creatives}` : ''}
${session.data.ad_goal ? `- Ad Goal: ${session.data.ad_goal}` : ''}
${session.data.customRequest ? `- Other Request: ${session.data.customRequest}` : ''}
- Links: ${session.data.links || 'None'}

📅 Book your call here: ${GHL_CALENDAR_LINK}`;

      delete userSessions[chatId];
      return ctx.reply(summary);

    default:
      return ctx.reply('Hmm, I didn’t catch that. Please type /start to begin again.');
  }
});
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

    // Add tag
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

    // Build note body
    let noteBody = `Source: Telegram Bot\nServices: ${services.join(', ')}\nName: ${name}\nCompany: ${company}\nEmail: ${email}\nPhone: ${phone}\n`;

    if (services.includes('ads')) {
      noteBody += `Ad Platforms: ${data.ad_platforms}\nAd Account: ${data.ad_account}\n`;
      if (data.ad_account_id) noteBody += `Ad Account ID: ${data.ad_account_id}\n`;
      noteBody += `Ad Budget: ${data.ad_budget}\nCreatives: ${data.ad_creatives}\nGoal: ${data.ad_goal}\n`;
    }

    if (data.social) {
      noteBody += `Socials:\n${data.social.map(s => `- ${s.platform}: ${s.link}${s.valid ? '' : ' ❌'}`).join('\n')}\n`;
    }

    if (data.customRequest) {
      noteBody += `Custom Request: ${data.customRequest}\n`;
    }

    noteBody += `Links: ${data.links || 'None'}\nConsent: Yes`;

    await axios.post(
      `https://rest.gohighlevel.com/v1/contacts/${contactId}/notes`,
      { body: noteBody },
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
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('❌ Failed to log to Google Sheets:', err.message);
  }
}

async function logToTelegramChannel(data) {
  try {
    const msg = `📥 New Submission Received:
Name: ${data.name}
Company: ${data.company}
Email: ${data.email}
Phone: ${data.phone}
Services: ${data.services?.join(', ') || ''}

${data.social ? `Socials:\n${data.social.map(s => `- ${s.platform}: ${s.link}${s.valid ? '' : ' ❌'}`).join('\n')}` : ''}
${data.ad_platforms ? `Ad Platforms: ${data.ad_platforms}` : ''}
${data.ad_account ? `Ad Account: ${data.ad_account}` : ''}
${data.ad_account_id ? `Ad Account ID: ${data.ad_account_id}` : ''}
${data.ad_budget ? `Budget: ${data.ad_budget}` : ''}
${data.ad_creatives ? `Creatives: ${data.ad_creatives}` : ''}
${data.ad_goal ? `Goal: ${data.ad_goal}` : ''}
${data.customRequest ? `Other Notes: ${data.customRequest}` : ''}
Links: ${data.links || 'None'}
✅ Consent: Yes`;

    await bot.telegram.sendMessage(process.env.TELEGRAM_CHANNEL_ID, msg);
  } catch (err) {
    console.error('❌ Failed to log to Telegram Channel:', err.message);
  }
}

// Set custom commands
bot.telegram.setMyCommands([
  { command: 'menu', description: 'Open Main Services Menu' }
]);

// Launch bot
bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));