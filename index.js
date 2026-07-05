import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { setupCronJobs } from './cron.js';
import { startServer } from './server.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

// 2. Setup WhatsApp Client (Headless Chromium)
const puppeteerOptions = {
  dumpio: false,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--log-level=3'
  ]
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: puppeteerOptions
});

client.on('qr', (qr) => {
  console.log('\n=========================================');
  console.log('📱 SCAN THIS QR WITH YOUR EXTRA PHONE:');
  console.log('=========================================\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ WhatsApp AI is ready and listening!');
  
  // Start the GUI server
  startServer(3000);
  
  // Setup cron jobs reading from database
  await setupCronJobs(client, openai, prisma);
});

// We capture message_create to also log AI's outgoing replies
client.on('message_create', async (msg) => {
  console.log(`✉️ [DEBUG] Message Event: From "${msg.from}" | To "${msg.to}" | Body: "${msg.body}"`);
  
  // If it's a message sent BY the bot, we should log it
  if (msg.fromMe) {
    // Determine who it was sent to
    const targetPhone = msg.to.split('@')[0];
    await logMessageToDb(targetPhone, msg.body, 'bot');
  }
});

// Helper to log messages to the DB based on the dd/mm/yy-phone-firstMsg logic
async function logMessageToDb(phone, body, sender) {
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }); // dd/mm/yy
  
  // Find if there's already a chat for this phone today
  let dailyChats = await prisma.dailyChat.findMany({
    where: { date: dateStr, senderPhone: phone }
  });
  
  let dailyChat = dailyChats[0];
  
  if (!dailyChat) {
    // Truncate first message for the ID to avoid huge primary keys
    const truncatedMsg = body.substring(0, 30).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-');
    const chatId = `${dateStr.replace(/\//g, '')}-${phone}-${truncatedMsg || 'empty'}`;
    
    dailyChat = await prisma.dailyChat.create({
      data: {
        id: chatId,
        date: dateStr,
        senderPhone: phone,
        firstMessage: body
      }
    });
  }

  await prisma.message.create({
    data: {
      dailyChatId: dailyChat.id,
      body: body,
      sender: sender
    }
  });
}

// 5. Listen for incoming messages
client.on('message', async (msg) => {
  console.log(`\n--- 📥 NEW MESSAGE ---`);
  
  let contact;
  try {
    contact = await Promise.race([
      msg.getContact(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout resolving contact')), 5000))
    ]);
  } catch (e) {
    console.log(`⚠️ Could not resolve contact details: ${e.message}`);
  }

  const allowedInputs = (process.env.ALLOWED_PHONE_NUMBERS || '')
    .split(',')
    .map(item => item.trim().toLowerCase());

  const fromRaw = msg.from.toLowerCase();
  const fromUser = msg.from.split('@')[0].toLowerCase();
  const authorRaw = (msg.author || '').toLowerCase();
  const authorUser = (msg.author || '').split('@')[0].toLowerCase();
  const contactNumber = (contact?.number || '').toLowerCase();
  const contactUser = (contact?.id?.user || '').toLowerCase();
  const hiddenPn = (msg._data?.author || msg._data?.senderPn || '').split('@')[0].toLowerCase();

  // Find the exact phone number matched
  let matchedPhone = null;

  const isAllowed = allowedInputs.some(input => {
    if (
      fromRaw === input || fromRaw === `${input}@c.us` || fromRaw === `${input}@lid` ||
      fromUser === input || authorRaw === input || authorRaw === `${input}@c.us` ||
      authorUser === input || (contactNumber && contactNumber === input) ||
      (contactUser && contactUser === input) || (hiddenPn && hiddenPn === input)
    ) {
      matchedPhone = input;
      return true;
    }
    return false;
  });

  if (!isAllowed) {
    console.log(`⚠️ Ignored message from unauthorized sender: ${msg.from}`);
    return;
  }
  
  // Use matchedPhone as the clean phone number identifier, fallback to fromUser
  const resolvedPhone = matchedPhone || fromUser;

  // Log incoming message to DB
  await logMessageToDb(resolvedPhone, msg.body, 'user');

  console.log(`🚀 Processing authorized message from ${msg.from}...`);

  try {
    // Read the instruction from Database
    const activeInst = await prisma.instruction.findFirst({ where: { isActive: true } });
    
    let systemPrompt = "You are a helpful AI assistant.";
    if (activeInst) {
      systemPrompt = activeInst.content;
    } else {
      // Fallback if no instructions are in DB yet
      if (fs.existsSync('./INSTRUCTIONS.md')) {
         systemPrompt = fs.readFileSync('./INSTRUCTIONS.md', 'utf-8');
      }
    }

    const response = await openai.chat.completions.create({
      model: process.env.MODEL_NAME || "google/gemini-3.1-flash-lite",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: msg.body }
      ]
    });

    const reply = response.choices[0].message.content;
    msg.reply(reply);
    // (The reply will be saved to DB via the 'message_create' handler)
  } catch (error) {
    console.error("AI Error:", error);
    msg.reply("Oops, my brain disconnected. Check the logs!");
  }
});

// Clean up locks and initialize the client
deleteLockFiles('./.wwebjs_auth');
client.initialize();
