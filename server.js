import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkYoutubeChannel } from './cron.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();

let whatsappClient = null;
let openaiClient = null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Instructions API ---

app.get('/api/instructions', async (req, res) => {
  const instructions = await prisma.instruction.findMany({ orderBy: { id: 'asc' } });
  res.json(instructions);
});

app.post('/api/instructions', async (req, res) => {
  const { name, content } = req.body;
  const newInst = await prisma.instruction.create({
    data: { name, content, isActive: false }
  });
  res.json(newInst);
});

app.put('/api/instructions/:id', async (req, res) => {
  const { id } = req.params;
  const { name, content, isActive } = req.body;

  const data = {};
  if (name !== undefined) data.name = name;
  if (content !== undefined) data.content = content;
  if (isActive !== undefined) {
    data.isActive = isActive;
    if (isActive) {
      // Deactivate all others first
      await prisma.instruction.updateMany({ data: { isActive: false } });
    }
  }

  const updated = await prisma.instruction.update({
    where: { id: parseInt(id) },
    data
  });
  res.json(updated);
});

app.delete('/api/instructions/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.instruction.delete({ where: { id: parseInt(id) } });
  res.json({ success: true });
});


// --- Daily Chats API ---

app.get('/api/chats', async (req, res) => {
  const { phone } = req.query;
  const where = phone ? { senderPhone: phone } : {};
  const chats = await prisma.dailyChat.findMany({
    where,
    include: { messages: true },
    orderBy: { date: 'desc' }
  });
  res.json(chats);
});


// --- Cron Tasks API ---

app.get('/api/cron', async (req, res) => {
  const tasks = await prisma.cronTask.findMany({ orderBy: { id: 'asc' } });
  res.json(tasks);
});

app.post('/api/cron', async (req, res) => {
  const { name, pattern, timezone, prompt, isOneTime, executeAt, targetPhones } = req.body;
  const newCron = await prisma.cronTask.create({
    data: { 
      name, 
      pattern, 
      timezone, 
      prompt, 
      targetPhones,
      isOneTime: !!isOneTime, 
      executeAt: executeAt ? new Date(executeAt) : null,
      isActive: true 
    }
  });
  res.json(newCron);
});

app.delete('/api/cron/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.cronTask.delete({ where: { id: parseInt(id) } });
  res.json({ success: true });
});

// --- Youtube Tracker API ---

app.get('/api/youtube', async (req, res) => {
  const channels = await prisma.youtubeChannel.findMany({ orderBy: { id: 'asc' } });
  res.json(channels);
});

app.post('/api/youtube', async (req, res) => {
  const { channelId, name, checkIntervalHours, resumePrompt, targetPhones } = req.body;
  const newChannel = await prisma.youtubeChannel.create({
    data: { 
      channelId, 
      name, 
      checkIntervalHours: parseInt(checkIntervalHours) || 1, 
      resumePrompt, 
      targetPhones,
      isActive: true 
    }
  });
  res.json(newChannel);
});

app.put('/api/youtube/:id', async (req, res) => {
  const { id } = req.params;
  const { channelId, name, checkIntervalHours, resumePrompt, isActive, targetPhones } = req.body;
  
  const data = {};
  if (channelId !== undefined) data.channelId = channelId;
  if (name !== undefined) data.name = name;
  if (checkIntervalHours !== undefined) data.checkIntervalHours = parseInt(checkIntervalHours);
  if (resumePrompt !== undefined) data.resumePrompt = resumePrompt;
  if (isActive !== undefined) data.isActive = isActive;
  if (targetPhones !== undefined) data.targetPhones = targetPhones;

  const updated = await prisma.youtubeChannel.update({
    where: { id: parseInt(id) },
    data
  });
  res.json(updated);
});

app.delete('/api/youtube/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.youtubeChannel.delete({ where: { id: parseInt(id) } });
  res.json({ success: true });
});

app.post('/api/youtube/:id/trigger', async (req, res) => {
  const { id } = req.params;
  try {
    if (!whatsappClient || !openaiClient) {
      return res.status(500).json({ error: "WhatsApp client or OpenAI client is not initialized." });
    }
    const result = await checkYoutubeChannel(parseInt(id), whatsappClient, openaiClient, prisma);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(`Error triggering YouTube check:`, error);
    res.status(500).json({ error: error.message });
  }
});



// --- Phones API ---

app.get('/api/phones', async (req, res) => {
  const phones = await prisma.phoneNumber.findMany({ 
    include: { instruction: true },
    orderBy: { id: 'asc' } 
  });
  res.json(phones);
});

app.post('/api/phones', async (req, res) => {
  const { number, modelName, instructionId, allowGroupChats, isEnabled, responseDelay, maxDailyMessages, contextCount } = req.body;
  try {
    const newPhone = await prisma.phoneNumber.create({
      data: {
        number,
        modelName,
        instructionId: instructionId ? parseInt(instructionId) : null,
        allowGroupChats: !!allowGroupChats,
        isEnabled: isEnabled !== undefined ? !!isEnabled : true,
        responseDelay: responseDelay ? parseInt(responseDelay) : 0,
        maxDailyMessages: maxDailyMessages !== undefined ? parseInt(maxDailyMessages) : 40,
        contextCount: contextCount !== undefined ? (isNaN(parseInt(contextCount)) ? 8 : parseInt(contextCount)) : 8
      }
    });
    res.json(newPhone);
  } catch (err) {
    res.status(400).json({ error: "Could not create phone number. Ensure it's unique." });
  }
});

app.put('/api/phones/:id', async (req, res) => {
  const { id } = req.params;
  const { number, modelName, instructionId, allowGroupChats, isEnabled, responseDelay, maxDailyMessages, contextCount } = req.body;
  
  const data = {};
  if (number !== undefined) data.number = number;
  if (modelName !== undefined) data.modelName = modelName;
  if (instructionId !== undefined) data.instructionId = instructionId ? parseInt(instructionId) : null;
  if (allowGroupChats !== undefined) data.allowGroupChats = !!allowGroupChats;
  if (isEnabled !== undefined) data.isEnabled = !!isEnabled;
  if (responseDelay !== undefined) data.responseDelay = parseInt(responseDelay) || 0;
  if (maxDailyMessages !== undefined) data.maxDailyMessages = parseInt(maxDailyMessages) || 40;
  if (contextCount !== undefined) data.contextCount = isNaN(parseInt(contextCount)) ? 8 : parseInt(contextCount);

  try {
    const updated = await prisma.phoneNumber.update({
      where: { id: parseInt(id) },
      data
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: "Could not update phone number." });
  }
});

app.delete('/api/phones/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.phoneNumber.delete({ where: { id: parseInt(id) } });
  res.json({ success: true });
});

export function startServer(port = 3000, client, openai) {
  whatsappClient = client;
  openaiClient = openai;
  app.listen(port, () => {
    console.log(`🌐 Web GUI running on port ${port}`);
  });
}
