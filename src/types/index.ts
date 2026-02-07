export interface NewsItem {
  title: string;
  url: string;
  source: string;
  category: 'crypto' | 'indian-stocks' | 'geopolitical';
  publishedAt?: Date;
  summary?: string;
}

export interface VerifiedNewsItem extends NewsItem {
  isVerified: boolean;
  verificationNote?: string;
}

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  change: number;
  changePercent: number;
  dayHigh?: number;
  dayLow?: number;
  marketState: string;
}

export interface CryptoPrice {
  symbol: string;
  priceUsd: number;
  priceInr?: number;
}

export interface CryptoCollectionResult {
  price: CryptoPrice;
  news: NewsItem[];
  errors: string[];
}

export interface StockCollectionResult {
  quotes: StockQuote[];
  news: NewsItem[];
  isWeekend: boolean;
  errors: string[];
}

export interface GeopoliticalCollectionResult {
  news: NewsItem[];
  errors: string[];
}

export interface MessageSection {
  title: string;
  htmlContent: string;
  category: 'crypto' | 'indian-stocks' | 'geopolitical';
}

export interface MarketStatus {
  isOpen: boolean;
  isWeekend: boolean;
  nextOpenDescription: string;
}

export interface AppConfig {
  telegramBotToken: string;
  telegramChatId: string;
  anthropicApiKey: string;
  newsApiKey: string;
  dbPath: string;
  cronScheduleMorning: string;
  cronScheduleEvening: string;
  timezone: string;
  maxRetries: number;
  retryDelayMs: number;
}
