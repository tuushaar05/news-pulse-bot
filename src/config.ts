import dotenv from 'dotenv';
import path from 'path';
import { AppConfig } from './types/index';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config: AppConfig = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  telegramChatId: requireEnv('TELEGRAM_CHAT_ID'),
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  newsApiKey: requireEnv('NEWS_API_KEY'),
  dbPath: path.join(__dirname, '..', 'data', 'news.db'),
  cronScheduleMorning: '0 10 * * *',
  cronScheduleEvening: '0 20 * * *',
  timezone: 'Asia/Kolkata',
  maxRetries: 3,
  retryDelayMs: 2000,
};

export const TRACKED_STOCKS = [
  { symbol: 'TCS.NS', name: 'TCS' },
  { symbol: 'CDSL.NS', name: 'CDSL' },
  { symbol: 'HINDUNILVR.NS', name: 'HUL' },
  { symbol: 'GOLDBEES.NS', name: 'GOLD' },
] as const;

export const TIER_1_SOURCES = [
  'Reuters', 'BBC', 'BBC World', 'Moneycontrol', 'CoinDesk',
  'Economic Times', 'LiveMint', 'Al Jazeera',
];
