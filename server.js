import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();

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
  const chats = await prisma.dailyChat.findMany({
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
  const { name, pattern, timezone, prompt, isOneTime, executeAt } = req.body;
  const newCron = await prisma.cronTask.create({
    data: { 
      name, 
      pattern, 
      timezone, 
      prompt, 
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

export function startServer(port = 3000) {
  app.listen(port, () => {
    console.log(`🌐 Web GUI running on port ${port}`);
  });
}
