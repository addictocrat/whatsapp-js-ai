# WhatsApp AI Assistant

A lightweight, secure WhatsApp AI assistant powered by [whatsapp-web.js](https://wwebjs.dev/) and OpenRouter. It features a Mini RAG system and automated cron tasks.

## System Components & Architecture
- **Headless WhatsApp Engine**: Leverages a sandboxed Chromium instance via `puppeteer` to emulate full-fidelity user interactions on WhatsApp Web, avoiding official API bottlenecks and restrictions.
- **Mini Offline RAG**: Integrates a prompt engineering pipeline that reads and injects instructions from `INSTRUCTIONS.md` into the model's system prompt prior to every message evaluation, facilitating hot-swappable behavioral updates without service disruption.
- **Scheduled Task Engine (Cron Jobs)**: Powered by a robust combination of `BullMQ` and `Redis`, executing high-precision, timezone-aware repeatable tasks (e.g., generating and dispatching custom Baudelairean poetry daily at 13:00 Europe/Istanbul timezone).

## Local Setup

### 1. Install
Install the dependencies:
```bash
npm install
```

### 2. Environment Variables
Copy the example environment file:
```bash
cp .example.env .env
```
*(On Windows, you can just manually duplicate the file and rename it to `.env`)*

Then, update your `.env` file with your details:
- `OPENROUTER_API_KEY`: Your API key from OpenRouter.
- `MODEL_NAME`: The model you want to use (e.g., `google/gemini-3.1-flash-lite`).
- `ALLOWED_PHONE_NUMBERS`: A comma-separated list of phone numbers the bot is allowed to reply to (format: country code + number, e.g., `905418956600,1234567890`).
- `REDIS_URL`: The connection string for your Redis database (e.g., `redis://localhost:6379`), required for the automated cron jobs.

### 3. Customize the AI
Edit the `INSTRUCTIONS.md` file to give your assistant a name, personality, and background facts.

### 4. Run it!
Start the bot:
```bash
npm start
```
1. Look at your terminal; a large QR code will appear.
2. Open WhatsApp on the phone you want to use as the bot (your "extra" phone).
3. Go to **Settings > Linked Devices > Link a Device** and scan the QR code.
4. Wait for the `✅ WhatsApp AI is ready and listening!` message.
5. Text your bot from your *main* phone number!

## Modifying the Schedule

The daily morning messages are scheduled using a cron expression. By default, it runs at `13:00` in the `Europe/Istanbul` timezone (`0 13 * * *`).

To change this:
1. Open `cron.js`.
2. Locate the `cronQueue.add` function inside the `setupCronJobs` function.
3. Change the `pattern` property to your desired cron schedule and update the `tz` to your preferred timezone.

## Deploying on Coolify

1. **Add Redis:** In your Coolify dashboard, click **Add New Resource** -> **Databases** -> **Redis**. Once started, copy the internal connection string.
2. Push this code to a private GitHub repo.
3. Click **Add New Resource** again and select your GitHub repo to deploy the app. Coolify will automatically read the `Dockerfile`.
4. Go to the **Environment Variables** tab of the app and add the variables from your `.env` file (`OPENROUTER_API_KEY`, `MODEL_NAME`, `ALLOWED_PHONE_NUMBERS`). Also add the `REDIS_URL` you copied from the Redis resource.
5. **CRITICAL:** Go to the **Storages** tab and add a persistent volume mapping to `/app/.wwebjs_auth`. If you skip this, you will have to re-scan the QR code every time your server restarts or updates!
5. Click **Deploy**.
6. Once deployed, click on the **Logs** tab in Coolify to find and scan the QR code for the first time.
