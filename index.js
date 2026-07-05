import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { setupCronJobs } from './cron.js';

// Helper to delete lingering Chromium lock files on container crash/restart
const deleteLockFiles = (dir) => {
  if (!fs.existsSync(dir)) return;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.lstatSync(filePath);
        if (stat.isDirectory()) {
          deleteLockFiles(filePath);
        } else if (file === 'SingletonLock' || file === 'SingletonCookie' || file === 'SingletonSocket') {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Removed lingering Chromium lock file: ${filePath}`);
        }
      } catch (err) {
        // Silently skip if files are already deleted or inaccessible
      }
    }
  } catch (err) {
    console.error("Error cleaning up lock files:", err.message);
  }
};


// 1. Initialize OpenRouter
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// 3. Setup WhatsApp Client (Headless Chromium)
const puppeteerOptions = {
  dumpio: false, // Turn off Chromium log piping to silence Dbus/ALSA warnings
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--log-level=3' // Silence internal Chromium logging warnings
  ]
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth(), // Saves login session locally
  puppeteer: puppeteerOptions
});


// 4. Generate QR Code in the console
client.on('qr', (qr) => {
  console.log('\n=========================================');
  console.log('📱 SCAN THIS QR WITH YOUR EXTRA PHONE:');
  console.log('=========================================\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ WhatsApp AI is ready and listening!');
  await setupCronJobs(client, openai);
});

// Debug: Log all message events (incoming and outgoing) to diagnose connection sync
client.on('message_create', (msg) => {
  console.log(`✉️ [DEBUG] Message Event: From "${msg.from}" | To "${msg.to}" | Body: "${msg.body}"`);
});

// 5. Listen for incoming messages
client.on('message', async (msg) => {
  console.log(`\n--- 📥 NEW MESSAGE ---`);
  console.log(`📩 From: ${msg.from} | Author (if group/lid): ${msg.author || 'N/A'} | Body: "${msg.body}"`);
  
  let contact;
  try {
    // Some LIDs take a long time or fail to resolve. We will add a timeout to not block.
    contact = await Promise.race([
      msg.getContact(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout resolving contact')), 5000))
    ]);
    console.log(`👤 Contact details resolved: ID: ${contact.id._serialized} | Number: ${contact.number || 'undefined'} | Name: ${contact.name || contact.pushname || 'undefined'}`);
  } catch (e) {
    console.log(`⚠️ Could not resolve contact details: ${e.message}`);
  }

  // ALLOWED_PHONE_NUMBERS can contain phone numbers or LIDs
  const allowedInputs = (process.env.ALLOWED_PHONE_NUMBERS || '')
    .split(',')
    .map(item => item.trim().toLowerCase());

  const fromRaw = msg.from.toLowerCase();
  const fromUser = msg.from.split('@')[0].toLowerCase();
  
  // msg.author is often the @c.us JID even when msg.from is @lid
  const authorRaw = (msg.author || '').toLowerCase();
  const authorUser = (msg.author || '').split('@')[0].toLowerCase();
  
  const contactNumber = (contact?.number || '').toLowerCase();
  const contactUser = (contact?.id?.user || '').toLowerCase();
  
  // Try to find the phone number in _data if it's hidden
  const hiddenPn = (msg._data?.author || msg._data?.senderPn || '').split('@')[0].toLowerCase();

  const isAllowed = allowedInputs.some(input => {
    return (
      fromRaw === input ||
      fromRaw === `${input}@c.us` ||
      fromRaw === `${input}@lid` ||
      fromUser === input ||
      authorRaw === input ||
      authorRaw === `${input}@c.us` ||
      authorUser === input ||
      (contactNumber && contactNumber === input) ||
      (contactUser && contactUser === input) ||
      (hiddenPn && hiddenPn === input)
    );
  });

  console.log(`🔍 Authorization Check:
  - Allowed List: ${JSON.stringify(allowedInputs)}
  - msg.from: ${fromRaw} (User: ${fromUser})
  - msg.author: ${authorRaw} (User: ${authorUser})
  - contact.number: ${contactNumber || 'N/A'}
  - hiddenPn: ${hiddenPn || 'N/A'}
  => Authorized: ${isAllowed}
  `);

  if (!isAllowed) {
    console.log(`⚠️ Ignored message from unauthorized sender: ${msg.from}`);
    return; // Ignore messages from anyone else so you don't burn tokens
  }

  console.log(`🚀 Processing authorized message from ${msg.from}...`);

  try {
    // Read the instructions dynamically so updates apply without restarting
    const systemPrompt = fs.readFileSync('./INSTRUCTIONS.md', 'utf-8');

    const response = await openai.chat.completions.create({
      model: process.env.MODEL_NAME || "google/gemini-3.1-flash-lite",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: msg.body }
      ]
    });

    const reply = response.choices[0].message.content;
    msg.reply(reply);
  } catch (error) {
    console.error("AI Error:", error);
    msg.reply("Oops, my brain disconnected. Check the logs!");
  }
});

// Clean up locks and initialize the client
deleteLockFiles('./.wwebjs_auth');
client.initialize();

