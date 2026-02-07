import dotenv from 'dotenv';
import path from 'path';
import { AppConfig, AIModelConfig, AIProvider } from './types/index';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveAIModel(): AIModelConfig {
  const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase() as AIProvider;

  switch (provider) {
    case 'openai':
      return {
        provider: 'openai',
        model: process.env.AI_MODEL || 'gpt-4o',
        apiKey: requireEnv('OPENAI_API_KEY'),
      };

    case 'grok':
      return {
        provider: 'grok',
        model: process.env.AI_MODEL || 'grok-3-mini-fast',
        apiKey: requireEnv('XAI_API_KEY'),
        baseUrl: 'https://api.x.ai/v1',
      };

    case 'claude':
    default:
      return {
        provider: 'claude',
        model: process.env.AI_MODEL || 'claude-sonnet-4-20250514',
        apiKey: requireEnv('ANTHROPIC_API_KEY'),
      };
  }
}

export const config: AppConfig = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  telegramChatId: requireEnv('TELEGRAM_CHAT_ID'),
  newsApiKey: requireEnv('NEWS_API_KEY'),
  aiModel: resolveAIModel(),
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
