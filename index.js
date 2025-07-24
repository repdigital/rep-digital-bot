require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GHL_CALENDAR_LINK = process.env.GHL_CALENDAR_LINK;

const userSessions = {};
const socialPlatforms = ['Facebook', 'Instagram', 'LinkedIn', 'Website/Other'];

function delay(ctx, ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  userSessions[chatId] = {};

  await ctx.replyWithChatAction('typing');
  await delay(ctx, 800);

  ctx.reply(
    '👋 Welcome to *rep.digital*! We help with:\n\n' +
    '❌ Removing negative content\n' +
    '🌟 Building positive online reputation\n' +
    '📢 Running paid ads\n' +
    '✏️ Other custom support\n\n' +
    'Use the buttons below to get started — or type /menu anytime to switch options.',
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Remove Negative Content', 'remove')],
      [Markup.button.callback('🌟 Build Positive Reputation', 'build')],
      [Markup.button.callback('✅ Both', 'both')],
      [Markup.button.callback('📢 Ad Platform Services', 'ads')],
      [Markup.button.callback('✏️ Other', 'other')]
    ])
  );
});

bot.action(['remove', 'build', 'both', 'ads', 'other'], async (ctx) => {
  const chatId = ctx.chat.id;
  const service = ctx.match.input;
  userSessions[chatId] = {
    services: service === 'both' ? ['remove', 'build'] : [service],
    social: [],
  };

  if (service === 'other') {
    await ctx.editMessageText("Got it — tell us briefly what you’re looking for:");
    userSessions[chatId].step = 'customQuery';
  } else {
    await ctx.editMessageText("Great! First up — what’s your full name?");
    userSessions[chatId].step = 'name';
  }
});

bot.hears('/menu', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = userSessions[chatId];

  if (session && session.step) {
    await ctx.reply(
      '⚠️ You’re mid-process. Start over?',
      Markup.keyboard([
        ['✅ Yes, start over'],
        ['❌ No, continue']
      ]).oneTime().resize()
    );
    session.step = 'confirmRestart';
  } else {
    await ctx.reply('Choose a service:', Markup.keyboard([
      ['❌ Negative Content Removal'],
      ['🌟 Positive Content Generation'],
      ['📢 Ad Platform / Marketing Services'],
      ['✏️ Other']
    ]).oneTime().resize());
  }
});
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();
  const session = userSessions[chatId];

  if (!session || !session.step) return;

  switch (session.step) {
    case 'confirmRestart':
      if (text.toLowerCase().includes('yes')) {
        return bot.start(ctx);
      } else {
        await ctx.reply('No problem — continuing from where we left off.');
        session.step = session.lastStep || 'name';
        return;
      }

    case 'name':
      session.name = text;
      session.step = 'email';
      return ctx.reply('Thanks! What’s your email address?');

    case 'email':
      session.email = text;
      session.step = 'phone';
      return ctx.reply('Great — what’s your phone number?');

    case 'phone':
      session.phone = text;
      session.step = 'company';
      return ctx.reply('Perfect. What’s your company name?');

    case 'company':
      session.company = text;

      if (session.services.includes('build')) {
        session.step = 'social_platform_select';
        return ctx.reply(
          'Let’s collect your social profiles to build your rep. Choose a platform:',
          Markup.keyboard([
            ...socialPlatforms.map(p => [p]),
            ['✅ No more links']
          ]).oneTime().resize()
        );
      }

      session.step = 'links';
      return ctx.reply('Any links we should review? Landing pages, articles, etc.');
    
    case 'customQuery':
      session.customRequest = text;
      session.step = 'consent';
      return ctx.reply('Thanks! Can we contact you using the info you provide? Reply YES to proceed.');

    case 'social_platform_select':
      if (text === '✅ No more links') {
        session.step = 'links';
        return ctx.reply('Got it! Now, any landing pages or review links we should take a look at?');
      }

      if (socialPlatforms.includes(text)) {
        session.pendingSocialPlatform = text;
        session.step = 'social_platform_link';
        return ctx.reply(`Please provide the URL for your ${text} profile:`);
      } else {
        return ctx.reply('Please select one of the buttons or type "✅ No more links" if done.');
      }

    case 'social_platform_link':
      if (!session.social) session.social = [];
      session.social.push({ platform: session.pendingSocialPlatform, link: text, valid: true });
      session.step = 'social_platform_select';
      return ctx.reply(
        'Link received! Add another?',
        Markup.keyboard([
          ...socialPlatforms.map(p => [p]),
          ['✅ No more links']
        ]).oneTime().resize()
      );
    case 'links':
      session.links = text;
      session.step = 'consent';
      return ctx.reply('Can we contact you using the info you’ve provided? Reply YES to continue.');

    case 'consent':
      if (text.toLowerCase() !== 'yes') {
        return ctx.reply('We need your permission to proceed. Please reply YES if you agree.');
      }

      await sendToGHL(session);
      await logToGoogleSheet(session);

      const serviceLabel = session.services.includes('ads')
        ? 'Ad Platform / Marketing Services'
        : session.services.includes('build')
        ? 'Positive Reputation'
        : session.services.includes('remove')
        ? 'Negative Content Removal'
        : 'Custom';

      let summary = `✅ Thanks, ${session.name}!\n\nHere’s what we’ve got:\n`;
      summary += `- Service: ${serviceLabel}\n`;
      summary += `- Company: ${session.company}\n`;
      summary += `- Email: ${session.email}\n`;
      summary += `- Phone: ${session.phone}\n`;

      if (session.social) {
        summary += `- Social Profiles:\n${session.social.map(s => `  • ${s.platform}: ${s.link}`).join('\n')}\n`;
      }

      if (session.links) {
        summary += `- Links: ${session.links}\n`;
      }

      if (session.customRequest) {
        summary += `- Request: ${session.customRequest}\n`;
      }

      summary += `\n📅 Ready to chat? Book your call here:\n${GHL_CALENDAR_LINK}`;

      delete userSessions[chatId];
      return ctx.reply(summary);

    default:
      return ctx.reply('Sorry — I didn’t understand that. You can type /start to begin again.');
  }
});
async function sendToGHL(data) {
  try {
    const { name, email, phone, company, services } = data;

    console.log("🔍 Looking up contact by email:", email);

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
      companyName: company,
      source: 'Telegram Bot'
    };

    if (existingContact) {
      contactId = existingContact.id;
      console.log("✅ Contact found. Updating contact ID:", contactId);
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
      console.log("🆕 Contact not found. Creating new contact...");
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
      contactId = createResponse.data.contact.id;
      console.log("✅ Contact created. New contact ID:", contactId);
    }

    // Add this before posting the note
    console.log("📝 Preparing to create note for contact ID:", contactId);

    let noteBody = `Source: Telegram Bot\nServices: ${services.join(', ')}\nName: ${name}\nCompany: ${company}\nEmail: ${email}\nPhone: ${phone}\n`;

    if (services.includes('ads')) {
      noteBody += `Ad Platforms: ${data.ad_platforms}\nAd Account: ${data.ad_account}\n`;
      if (data.ad_account_id) noteBody += `Ad Account ID: ${data.ad_account_id}\n`;
      noteBody += `Ad Budget: ${data.ad_budget}\nCreatives: ${data.ad_creatives}\nGoal: ${data.ad_goal}\nLinks: ${data.links}\nConsent: Yes`;
    } else if (data.social) {
      noteBody += `Socials:\n${data.social.map(s => `- ${s.platform}: ${s.link}${s.valid ? '' : ' ❌'}`).join('\n')}\nLinks: ${data.links}\nConsent: Yes`;
    } else if (data.customRequest) {
      noteBody += `Request Details: ${data.customRequest}\nConsent: Yes`;
    }

    console.log("📄 Note body to be sent:\n", noteBody);

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

    console.log("✅ Note successfully added to contact:", contactId);

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
      company: data.company,
      services: data.services.join(', '),
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
    console.error('❌ Google Sheets Logging Error:', err.message);
  }
}

bot.telegram.setMyCommands([
  { command: 'menu', description: 'Open Main Services Menu' }
]);

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
