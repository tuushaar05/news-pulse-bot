# News Pulse Bot

A Telegram bot that sends curated, AI-verified news summaries twice daily covering cryptocurrency, Indian stock market, and geopolitical news.

## Features

- **Crypto Updates**: BTC price (USD & INR) + top 5 verified crypto news from CoinDesk, CoinTelegraph, CryptoCompare, and Google News
- **Indian Stock Market**: Live/closing prices for TCS, CDSL, HUL, and Gold (GOLDBEES ETF) + up to 10 market news items from Moneycontrol, Economic Times, LiveMint, NewsAPI, and Google News
- **Geopolitical News**: Top 5 international news from BBC World, Al Jazeera, NewsAPI, and Google News
- **AI Verification**: Every news item is verified by Claude AI before being sent - clickbait and unreliable items are filtered out
- **Deduplication**: SHA-256 based deduplication via SQLite prevents repeated news across runs
- **Smart Scheduling**: Sends at 10:00 AM and 8:00 PM IST daily, with reduced content on weekends
- **Market Awareness**: Detects if Indian stock market is open/closed/weekend and adjusts messaging

## Architecture

```
Cron (10AM/8PM IST) or --test-send
            |
            v
     Main Orchestrator
            |
            +---> Crypto Collector (CoinGecko + RSS + CryptoCompare)
            +---> Indian Stocks Collector (Yahoo Finance + RSS + NewsAPI)
            +---> Geopolitical Collector (BBC + Al Jazeera + RSS + NewsAPI)
            |         (all run in parallel via Promise.allSettled)
            v
     Deduplication (SQLite SHA-256)
            |
            v
     AI Verification (Claude API - single batch call)
            |
            v
     Telegram Sender (HTML format, auto-split at 4096 chars)
```

## Prerequisites

- Node.js 20+
- npm

## Getting API Keys

### 1. Telegram Bot Token
1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNO...`)

### 2. Telegram Chat ID
1. Search for **@userinfobot** on Telegram
2. Send `/start` to it
3. It will reply with your Chat ID (a number like `123456789`)

### 3. Anthropic API Key
1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Create an account or sign in
3. Navigate to **API Keys** and create a new key

### 4. NewsAPI Key
1. Go to [newsapi.org/register](https://newsapi.org/register)
2. Create a free account
3. Copy your API key from the dashboard
4. Free tier: 100 requests/day (the bot uses ~40/day)

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/tuushaar05/news-pulse-bot.git
   cd news-pulse-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your API keys:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_CHAT_ID=your_chat_id
   ANTHROPIC_API_KEY=your_anthropic_key
   NEWS_API_KEY=your_newsapi_key
   ```

4. **Test the bot**
   ```bash
   npm run test-send
   ```
   This will immediately run the full pipeline and send a news bulletin to your Telegram chat.

5. **Run in development mode**
   ```bash
   npm run dev
   ```
   The bot will start, send a startup notification, and wait for the scheduled cron times (10 AM and 8 PM IST).

## Production Build

```bash
npm run build
npm start
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Run with tsx (development, auto-reload not included) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled JavaScript |
| `npm run test-send` | Immediately send one news bulletin (bypass cron) |

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/health` | Check bot status, uptime, and database stats |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your personal Telegram chat ID |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for news verification |
| `NEWS_API_KEY` | Yes | NewsAPI.org key for additional news sources |

## Docker Deployment

```bash
# Build and run
docker compose up -d

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose up -d --build
```

The `docker-compose.yml` mounts `./data` as a volume so the SQLite database persists across container restarts.

## Deploying on Coolify

If you have [Coolify](https://coolify.io/) installed on your server, follow these steps:

### 1. Create a New Project
- Log into your Coolify dashboard
- Click **"New Project"** and give it a name (e.g., "News Pulse Bot")

### 2. Add a New Resource
- Inside the project, click **"Add New Resource"**
- Select **"Docker Compose"** as the deployment type

### 3. Connect GitHub Repository
- Choose **GitHub** as the source
- If you haven't already, connect your GitHub account via Coolify's GitHub App integration
- Select the `news-pulse-bot` repository
- Set the branch to `main`

### 4. Configure Environment Variables
- Go to the **Environment** tab in your resource settings
- Add each environment variable:
  - `TELEGRAM_BOT_TOKEN` = your bot token
  - `TELEGRAM_CHAT_ID` = your chat ID
  - `ANTHROPIC_API_KEY` = your Anthropic key
  - `NEWS_API_KEY` = your NewsAPI key

### 5. Set Up Persistent Storage
- Go to the **Storages** tab
- Add a volume mount:
  - **Source**: `/data/coolify/news-pulse-bot` (or any path on your server)
  - **Destination**: `/app/data`
- This ensures the SQLite database survives container rebuilds

### 6. Deploy
- Click **Deploy**
- Coolify will build the Docker image and start the container
- Check the **Logs** tab to verify the bot started successfully
- You should see: `news-pulse-bot starting...` followed by `Bot polling started`

### 7. Verify
- Send `/health` to your bot on Telegram
- Wait for the next scheduled run (10 AM or 8 PM IST) or trigger a manual test by SSH-ing into the container and running `node dist/index.js --test-send`

## How It Works

1. **Collection**: At scheduled times, three collectors run in parallel fetching news from RSS feeds, APIs, and Google News
2. **Deduplication**: Each news item is hashed (SHA-256 of URL + title) and checked against a SQLite database. Previously sent items are skipped
3. **Verification**: All new items are sent to Claude AI in a single API call. Items rated as clickbait, unreliable, or fabricated are filtered out
4. **Formatting**: Remaining items are formatted as an HTML Telegram message with sections for crypto, stocks, and geopolitical news
5. **Sending**: If the message exceeds Telegram's 4096 character limit, it's split at section boundaries and sent as multiple messages
6. **Cleanup**: Database entries older than 7 days are automatically removed

## Cost

- **Claude API**: ~$0.002 per run (~$0.12/month for twice-daily runs)
- **All other APIs**: Free tier

## License

MIT
