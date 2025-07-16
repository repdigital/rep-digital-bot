// index.js (final update with graceful link handling + dual-service selection)
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

  ctx.reply(
    '👋 Hey there! Welcome to rep.digital.\n\nWe specialize in removing negative content and building powerful online reputations. What would you like help with today?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('❌ Remove Negative Content', 'remove'),
        Markup.button.callback('🌟 Build Positive Reputation', 'build')
      ],
      [
        Markup.button.callback('✅ Both', 'both')
      ]
    ])
  );
});

bot.action(['remove', 'build', 'both'], async (ctx) => {
  const chatId = ctx.chat.id;
  userSessions[chatId] = {
    services: ctx.match.input === 'both' ? ['remove', 'build'] : [ctx.match.input],
  };

  await ctx.editMessageText("Awesome! I can help with that. First things first — what’s your full name?");
  userSessions[chatId].step = 'name';
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
      session.step = 'social_prompt';
      return ctx.reply(
        'Which social media platform are you sharing a link for?',
        Markup.keyboard([['Facebook', 'Instagram'], ['LinkedIn', 'Other']]).oneTime().resize()
      );

    case 'social_prompt':
      session.currentSocial = text;
      session.step = 'social_link';
      return ctx.reply(`Please send the link for ${text}:`);

    case 'social_link':
      if (!session.social) session.social = [];
      const isValidLink = text.startsWith('http');
      session.social.push({ platform: session.currentSocial, link: text, valid: isValidLink });

      session.step = 'more_socials';
      return ctx.reply('Would you like to add another social media link?', Markup.keyboard([['Yes', 'No']]).oneTime().resize());

    case 'more_socials':
      if (text.toLowerCase() === 'yes') {
        session.step = 'social_prompt';
        return ctx.reply('Which social media platform?');
      } else {
        session.step = 'links';
        return ctx.reply('Do you have any website URLs or article links you’d like us to review for de-indexing or removal?');
      }

    case 'consent':
      if (text.trim().toLowerCase() !== 'yes') {
        return ctx.reply('We need your consent to contact you. Please reply YES to proceed.');
      }

      await sendToGHL(session);
      await logToGoogleSheet(session);

      const serviceLabel = session.services.includes('remove') && session.services.includes('build')
        ? 'Remove Negative Content + Build Positive Reputation'
        : session.services.includes('remove')
        ? 'Remove Negative Content'
        : 'Build Positive Reputation';

      const socialList = session.social.map(s => `- ${s.platform}: ${s.link}${s.valid ? '' : ' ❌'}`).join('
');

      const summary = `✅ Thanks, ${session.name}!

Here’s what we have:

` +
        `- Service: ${serviceLabel}
- Company: ${session.company}
- Email: ${session.email}
- Phone: ${session.phone}
- Socials:
${socialList}
- Website Links: ${session.links}

📅 Book your call here: ${GHL_CALENDAR_LINK}`;

      delete userSessions[chatId];
      return ctx.reply(summary);

    default:
      return ctx.reply('Something went wrong. Type /start to begin again.');
  }
});

async function sendToGHL(data) {
  try {
    const { name, email, phone, company, social, links, services } = data;

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

    if (existingContact) {
      contactId = existingContact.id;
      await axios.put(
        `https://rest.gohighlevel.com/v1/contacts/${contactId}`,
        {
          email,
          phone,
          firstName: name.split(' ')[0],
          lastName: name.split(' ')[1] || '',
          companyName: company,
        },
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
        {
          locationId: process.env.GHL_LOCATION_ID,
          email,
          phone,
          firstName: name.split(' ')[0],
          lastName: name.split(' ')[1] || '',
          companyName: company,
          source: 'Telegram Bot',
        },
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

    const noteBody = `Source: Telegram Bot\nServices: ${services.join(', ')}\nName: ${name}\nCompany: ${company}\nEmail: ${email}\nPhone: ${phone}\n` +
      `Socials:\n${social.map(s => `- ${s.platform}: ${s.link}${s.valid ? '' : ' ❌'}`).join('\n')}\nLinks: ${links}
Consent: Yes`;

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
      company: data.company,
      services: data.services.join(', '),
      socialLinks: data.social.map(s => `${s.platform}: ${s.link}`).join('; '),
      links: data.links,
  consent: 'yes',
      timestamp: new Date().toISOString(),
    };

    // Placeholder: Replace with actual Google Sheets logging logic/API call
    console.log('📝 Logging to Google Sheets:', payload);

  } catch (err) {
    console.error('❌ Failed to log to Google Sheets:', err.message);
  }
}

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
