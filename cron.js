import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { YoutubeTranscript } from 'youtube-transcript';

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
          { prompt: task.prompt, isOneTimeId: task.id, targetPhones: task.targetPhones },
          { delay }
        );
        console.log(`⏰ One-time job '${task.name}' scheduled for ${task.executeAt} (delay: ${Math.round(delay/1000)}s).`);
      }
    } else if (task.pattern) {
      await cronQueue.add(
        task.name,
        { prompt: task.prompt, targetPhones: task.targetPhones },
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
      const modelToUse = process.env.MODEL_NAME || "google/gemini-3.1-flash-lite";
      const response = await openai.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: "system", content: "You are an AI assistant executing a scheduled background task." },
          { role: "user", content: job.data.prompt }
        ]
      });

      const reply = response.choices[0].message.content;

      let targetNumbers = [];
      if (job.data.targetPhones && job.data.targetPhones.trim().length > 0) {
        targetNumbers = job.data.targetPhones
          .split(',')
          .map(num => num.trim())
          .filter(num => num.length > 0);
      } else {
        const envNumbers = (process.env.ALLOWED_PHONE_NUMBERS || '')
          .split(',')
          .map(num => num.trim())
          .filter(num => num.length > 0);
          
        const dbPhones = await prisma.phoneNumber.findMany();
        const dbNumbers = dbPhones.map(p => p.number.trim());

        targetNumbers = [...new Set([...envNumbers, ...dbNumbers])];
      }

      for (const num of targetNumbers) {
        const numberId = `${num}@c.us`;
        await client.sendMessage(numberId, reply);
        console.log(`✅ Message for '${job.name}' sent to ${numberId}`);
      }
    } catch (error) {
      console.error(`❌ Failed to run cron job '${job.name}':`, error);
    }
  }, { connection });

  // --- YouTube Cron Setup ---
  const ytQueue = new Queue('youtube-cron', { connection });
  const oldYtJobs = await ytQueue.getRepeatableJobs();
  for (const job of oldYtJobs) {
    await ytQueue.removeRepeatableByKey(job.key);
  }

  const ytChannels = await prisma.youtubeChannel.findMany({ where: { isActive: true } });
  for (const channel of ytChannels) {
    const pattern = `0 */${channel.checkIntervalHours} * * *`;
    await ytQueue.add(
      `yt-${channel.id}`,
      { channelId: channel.id },
      { repeat: { pattern } }
    );
    console.log(`⏰ YouTube job for '${channel.name}' scheduled for ${pattern}.`);
  }

  const ytWorker = new Worker('youtube-cron', async (job) => {
    const channelId = job.data.channelId;
    const channel = await prisma.youtubeChannel.findUnique({ where: { id: channelId } });
    if (!channel || !channel.isActive) return;

    try {
      await checkYoutubeChannel(channelId, client, openai, prisma);
    } catch (error) {
      console.error(`❌ Failed to run YouTube cron for '${channel.name}':`, error);
    }
  }, { connection });
}

/**
 * Checks a specific YouTube channel for a new video, generates an AI summary, and sends it to the target phone numbers.
 * @param {number} channelId 
 * @param {import('whatsapp-web.js').Client} client 
 * @param {import('openai').OpenAI} openai 
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function checkYoutubeChannel(channelId, client, openai, prisma, force = false) {
  const channel = await prisma.youtubeChannel.findUnique({ where: { id: channelId } });
  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  console.log(`▶️ Checking YouTube channel '${channel.name}' for new videos (force: ${force})...`);

  try {
    // Fetch latest video using RSS
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
    const ytRes = await fetch(rssUrl);
    const rssText = await ytRes.text();

    const videoIdMatch = rssText.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
    if (!videoIdMatch) {
      console.log(`ℹ️ No videos found for channel '${channel.name}'.`);
      return { newVideo: false, reason: "No videos found" };
    }

    const videoId = videoIdMatch[1];

    if (!force && channel.lastVideoId === videoId) {
      console.log(`ℹ️ No new videos for channel '${channel.name}'.`);
      return { newVideo: false, reason: "No new video (matches lastVideoId)" };
    }

    console.log(`🆕 New video found for '${channel.name}': ${videoId}. Extracting transcript...`);

    // Update lastVideoId immediately to prevent duplicate runs
    await prisma.youtubeChannel.update({
      where: { id: channel.id },
      data: { lastVideoId: videoId }
    });

    // Extract transcript
    let transcriptText = "";
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
        fetch: (url, options) => {
          const headers = { ...(options?.headers || {}) };
          // Preserve the original User-Agent if the library set it (e.g. for Android InnerTube API)
          if (!headers['User-Agent'] && !headers['user-agent']) {
            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
          }
          headers['Cookie'] = 'CONSENT=YES+cb.20210328-17-p0.en+FX+478';
          headers['Accept-Language'] = 'en-US,en;q=0.9';
          
          return fetch(url, { ...options, headers });
        }
      });
      transcriptText = transcript.map(t => t.text).join(' ');
    } catch (err) {
      if (err.message.includes('Transcript is disabled') || err.message.includes('No transcripts')) {
        console.log(`ℹ️ Transcript not available yet for video ${videoId}. Reverting lastVideoId...`);
        // Revert lastVideoId so it can be retried later
        await prisma.youtubeChannel.update({
          where: { id: channel.id },
          data: { lastVideoId: channel.lastVideoId }
        });
        return { newVideo: false, reason: "Transcript not yet available (auto-generated captions might still be processing)" };
      }

      console.error(`❌ Could not fetch transcript for video ${videoId}:`, err.message);
      // Revert lastVideoId on other errors too so we retry
      await prisma.youtubeChannel.update({
        where: { id: channel.id },
        data: { lastVideoId: channel.lastVideoId }
      });
      throw new Error(`Could not fetch transcript for video ${videoId}: ${err.message}`);
    }

    if (!transcriptText) {
       console.log(`ℹ️ Transcript empty for video ${videoId}.`);
       return { newVideo: false, reason: "Transcript is empty" };
    }

    // Truncate transcript to 50k chars to avoid hitting token limits
    if (transcriptText.length > 50000) {
      transcriptText = transcriptText.substring(0, 50000) + "... [TRUNCATED]";
    }

    const modelToUse = process.env.MODEL_NAME || "google/gemini-3.1-flash-lite";
    
    const prompt = `${channel.resumePrompt}\n\nTranscript:\n${transcriptText}`;

    const response = await openai.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: "You are an AI assistant tasked with summarizing a YouTube video transcript." },
        { role: "user", content: prompt }
      ]
    });

    const reply = response.choices[0].message.content;

    // Send message
    let targetNumbers = [];
    if (channel.targetPhones && channel.targetPhones.trim().length > 0) {
      targetNumbers = channel.targetPhones
        .split(',')
        .map(num => num.trim())
        .filter(num => num.length > 0);
    } else {
      const envNumbers = (process.env.ALLOWED_PHONE_NUMBERS || '')
        .split(',')
        .map(num => num.trim())
        .filter(num => num.length > 0);
        
      const dbPhones = await prisma.phoneNumber.findMany();
      const dbNumbers = dbPhones.map(p => p.number.trim());
      targetNumbers = [...new Set([...envNumbers, ...dbNumbers])];
    }

    const prefix = `📺 *New Video from ${channel.name}!*\nhttps://youtube.com/watch?v=${videoId}\n\n`;

    for (const num of targetNumbers) {
      const numberId = `${num}@c.us`;
      await client.sendMessage(numberId, prefix + reply);
      console.log(`✅ YouTube summary for '${channel.name}' sent to ${numberId}`);
    }

    return { newVideo: true, videoId, targetNumbers };
  } catch (error) {
    console.error(`❌ Failed to run YouTube check for '${channel.name}':`, error);
    throw error;
  }
}
