# WhatsApp AI Assistant

A lightweight, secure WhatsApp AI assistant powered by [whatsapp-web.js](https://wwebjs.dev/) and OpenRouter. It features a Web GUI, Database-backed Chat Logs, dynamic Instructions, and automated cron tasks.

## System Components & Architecture
- **Headless WhatsApp Engine**: Leverages a sandboxed Chromium instance via `puppeteer` to emulate full-fidelity user interactions on WhatsApp Web, avoiding official API bottlenecks and restrictions.
- **PostgreSQL Database**: Uses Prisma ORM to persistently store System Instructions, Daily Chat Logs, and scheduled Cron Tasks. Chat logs are uniquely grouped by `DD/MM/YY-Phone-FirstMessage`.
- **Minimalist Web GUI**: An Express backend and Vanilla JS frontend (exposed on Port 3000) allows you to dynamically update the active AI Instruction, review chat histories, and schedule new automated tasks without touching the code.
- **Scheduled Task Engine (Cron Jobs)**: Powered by a robust combination of `BullMQ` and `Redis`, executing high-precision, timezone-aware repeatable tasks. Tasks are managed directly from the Web GUI.

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
- `REDIS_URL`: The connection string for your Redis database.
- `DATABASE_URL`: The connection string for your PostgreSQL database (e.g., `postgresql://user:password@localhost:5432/dbname`).

### 3. Setup the Database
Push the Prisma schema to your PostgreSQL database:
```bash
npx prisma db push
```

### 4. Run it!
Start the bot:
```bash
npm start
```
1. Look at your terminal; a large QR code will appear.
2. Open WhatsApp on the phone you want to use as the bot (your "extra" phone).
3. Go to **Settings > Linked Devices > Link a Device** and scan the QR code.
4. Wait for the `✅ WhatsApp AI is ready and listening!` message.
5. Open your browser and navigate to `http://localhost:3000` to access the Web GUI and set your first System Instruction.
6. Text your bot from your *main* phone number!

## Modifying the Schedule & Instructions

Both System Instructions and Scheduled Tasks (Cron Jobs) are now managed dynamically via the Web GUI at `http://localhost:3000`.

## Deploying on Coolify

1. **Add Redis & PostgreSQL:** In your Coolify dashboard, click **Add New Resource** -> **Databases**. Add both a **Redis** instance and a **PostgreSQL** instance. Once started, copy their internal connection strings.
2. Push this code to a private GitHub repo.
3. Click **Add New Resource** again and select your GitHub repo to deploy the app. Coolify will automatically read the `Dockerfile` and run `prisma generate`.
4. Go to the **Environment Variables** tab of the app and add the variables from your `.env` file (`OPENROUTER_API_KEY`, `MODEL_NAME`, `ALLOWED_PHONE_NUMBERS`). Also add the `REDIS_URL` and `DATABASE_URL` you copied from the resources.
5. **CRITICAL:** Go to the **Storages** tab and add a persistent volume mapping to `/app/.wwebjs_auth`. If you skip this, you will have to re-scan the QR code every time your server restarts or updates!
6. **CRITICAL:** Go to the **Ports** tab and expose port `3000` so you can access the Web GUI from your domain.
7. Click **Deploy**.
8. Once deployed, click on the **Logs** tab in Coolify to find and scan the QR code for the first time.
