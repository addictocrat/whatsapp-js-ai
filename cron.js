import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Initializes and schedules repeatable cron jobs via BullMQ
 * @param {import('whatsapp-web.js').Client} client 
 * @param {import('openai').OpenAI} openai 
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function setupCronJobs(client, openai, prisma) {
  const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
  });

  const cronQueue = new Queue('whatsapp-cron', { connection });

  // 1. Clear old jobs so we don't duplicate them
  const oldJobs = await cronQueue.getRepeatableJobs();
  for (const job of oldJobs) {
    await cronQueue.removeRepeatableByKey(job.key);
  }

  // 2. Fetch active tasks from DB
  const tasks = await prisma.cronTask.findMany({ where: { isActive: true } });

  for (const task of tasks) {
    if (task.isOneTime) {
      if (task.executeAt && new Date(task.executeAt) > new Date()) {
        const delay = new Date(task.executeAt).getTime() - Date.now();
        await cronQueue.add(
          task.name,
          { prompt: task.prompt, isOneTimeId: task.id },
          { delay }
        );
        console.log(`⏰ One-time job '${task.name}' scheduled for ${task.executeAt} (delay: ${Math.round(delay/1000)}s).`);
      }
    } else if (task.pattern) {
      await cronQueue.add(
        task.name,
        { prompt: task.prompt },
        {
          repeat: {
            pattern: task.pattern,
            tz: task.timezone,
          },
        }
      );
      console.log(`⏰ Cron job '${task.name}' scheduled for ${task.pattern} (${task.timezone}).`);
    }
  }

  // Setup BullMQ Worker
  const worker = new Worker('whatsapp-cron', async (job) => {
    console.log(`🌅 Running cron job '${job.name}'...`);

    if (job.data.isOneTimeId) {
      try {
        await prisma.cronTask.update({
          where: { id: job.data.isOneTimeId },
          data: { isActive: false }
        });
        console.log(`📌 One-time job '${job.name}' marked inactive in DB.`);
      } catch (err) {
        console.error(`Failed to mark one-time job '${job.name}' inactive:`, err.message);
      }
    }

    try {
      const response = await openai.chat.completions.create({
        model: process.env.MODEL_NAME || "google/gemini-3.1-flash-lite",
        messages: [
          { role: "system", content: "You are an AI assistant executing a scheduled background task." },
          { role: "user", content: job.data.prompt }
        ]
      });

      const reply = response.choices[0].message.content;

      const allowedNumbers = (process.env.ALLOWED_PHONE_NUMBERS || '')
        .split(',')
        .map(num => `${num.trim()}@c.us`);

      for (const numberId of allowedNumbers) {
        if (numberId.trim() !== '@c.us') {
          await client.sendMessage(numberId, reply);
          console.log(`✅ Message for '${job.name}' sent to ${numberId}`);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to run cron job '${job.name}':`, error);
    }
  }, { connection });
}
