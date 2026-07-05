import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Initializes and schedules repeatable cron jobs via BullMQ
 * @param {import('whatsapp-web.js').Client} client 
 * @param {import('openai').OpenAI} openai 
 */
export async function setupCronJobs(client, openai) {
  // Setup BullMQ Queue Connection
  const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
  });

  const cronQueue = new Queue('whatsapp-cron', { connection });

  // Add the repeatable job
  // 13:00pm Turkey time is 13:00 in Europe/Istanbul timezone
  await cronQueue.add(
    'send-good-morning',
    {},
    {
      repeat: {
        pattern: '0 13 * * *',
        tz: 'Europe/Istanbul',
      },
    }
  );

  console.log('⏰ Cron job scheduled for 13:00 Europe/Istanbul.');

  // Setup BullMQ Worker
  const worker = new Worker('whatsapp-cron', async (job) => {
    if (job.name === 'send-good-morning') {
      console.log('🌅 Running morning cron job...');

      try {
        const response = await openai.chat.completions.create({
          model: process.env.MODEL_NAME || "google/gemini-3.1-flash-lite",
          messages: [
            { role: "system", content: "You are an AI assistant. Write a very short Baudelairean poem saying good morning." },
          ]
        });

        const poem = response.choices[0].message.content;
        const message = `Good morning!\n\n${poem}`;

        const allowedNumbers = (process.env.ALLOWED_PHONE_NUMBERS || '')
          .split(',')
          .map(num => `${num.trim()}@c.us`);

        for (const numberId of allowedNumbers) {
          if (numberId.trim() !== '@c.us') {
            await client.sendMessage(numberId, message);
            console.log(`✅ Morning message sent to ${numberId}`);
          }
        }
      } catch (error) {
        console.error("❌ Failed to run morning cron job:", error);
      }
    }
  }, { connection });
}
