import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { NewsItem, StockQuote, StockCollectionResult } from '../types/index';
import { TRACKED_STOCKS } from '../config';
import { withRetry, isWeekendIndia, log, truncate, stripHtml, cleanGoogleNewsTitle } from '../utils/helpers';

const GOOGLE_NEWS_STOCK_QUERIES = [
  'TCS stock news',
  'CDSL stock news',
  'HUL Hindustan Unilever stock',
  'Gold price India',
  'Indian stock market today',
];

const NEWSAPI_STOCKS_URL = 'https://newsapi.org/v2/everything?q=indian+stock+market+OR+NSE+OR+Sensex&language=en&sortBy=publishedAt&pageSize=10';

const RSS_FEEDS = [
  { url: 'https://www.moneycontrol.com/rss/marketreports.xml', name: 'Moneycontrol' },
  { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', name: 'Economic Times' },
  { url: 'https://www.livemint.com/rss/markets', name: 'LiveMint' },
];

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export async function collectIndianStockNews(): Promise<StockCollectionResult> {
  const errors: string[] = [];
  const weekend = isWeekendIndia();
  let quotes: StockQuote[] = [];
  const allNews: NewsItem[] = [];

  const fetchTasks: Promise<NewsItem[]>[] = [
    ...GOOGLE_NEWS_STOCK_QUERIES.map(q => fetchGoogleNewsRss(q)),
    fetchNewsApiStocks(),
    ...RSS_FEEDS.map(feed => fetchRssFeed(feed.url, feed.name)),
  ];

  const [quotesResult, ...newsResults] = await Promise.allSettled([
    fetchStockQuotes(),
    ...fetchTasks,
  ]);

  if (quotesResult.status === 'fulfilled') {
    quotes = quotesResult.value;
  } else {
    errors.push(`Stock quotes failed: ${quotesResult.reason}`);
    log('error', 'Stock quotes failed', { error: String(quotesResult.reason) });
  }

  for (const result of newsResults) {
    if (result.status === 'fulfilled') {
      allNews.push(...result.value);
    } else {
      errors.push(`Market news source failed: ${result.reason}`);
      log('warn', 'Market news source failed', { error: String(result.reason) });
    }
  }

  const unique = deduplicateByTitle(allNews);
  unique.sort((a, b) => {
    const dateA = a.publishedAt?.getTime() || 0;
    const dateB = b.publishedAt?.getTime() || 0;
    return dateB - dateA;
  });

  const maxNews = weekend ? 5 : 10;
  log('info', `[STOCKS] Fetched ${allNews.length} raw items, ${unique.length} after local dedup, weekend=${weekend}`);

  return {
    quotes,
    news: unique.slice(0, maxNews),
    isWeekend: weekend,
    errors,
  };
}

async function fetchStockQuotes(): Promise<StockQuote[]> {
  return withRetry(async () => {
    const mod = await import('yahoo-finance2');
    const yahooFinance = mod.default;

    const results = await Promise.allSettled(
      TRACKED_STOCKS.map(stock => (yahooFinance as any).quote(stock.symbol))
    );

    const quotes: StockQuote[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const stock = TRACKED_STOCKS[i];
      if (result.status === 'fulfilled' && result.value) {
        const q = result.value;
        quotes.push({
          symbol: stock.symbol,
          name: stock.name,
          price: q.regularMarketPrice || 0,
          currency: q.currency || 'INR',
          change: q.regularMarketChange || 0,
          changePercent: q.regularMarketChangePercent || 0,
          dayHigh: q.regularMarketDayHigh,
          dayLow: q.regularMarketDayLow,
          marketState: q.marketState || 'UNKNOWN',
        });
      } else {
        log('warn', `Failed to fetch quote for ${stock.symbol}`, {
          error: result.status === 'rejected' ? String(result.reason) : 'empty result',
        });
      }
    }
    return quotes;
  }, 2, 3000, 'Yahoo Finance quotes');
}

async function fetchGoogleNewsRss(query: string): Promise<NewsItem[]> {
  return withRetry(async () => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'NewsPulseBot/1.0' },
    });
    const parsed = xmlParser.parse(response.data);
    const items = parsed?.rss?.channel?.item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.slice(0, 5).map((item: any) => {
      const { cleanTitle, source } = cleanGoogleNewsTitle(String(item.title || ''));
      return {
        title: cleanTitle,
        url: String(item.link || ''),
        source,
        category: 'indian-stocks' as const,
        publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        summary: truncate(stripHtml(String(item.description || '')), 200),
      };
    });
  }, 2, 3000, `Google News: ${query}`);
}

async function fetchNewsApiStocks(): Promise<NewsItem[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    log('warn', 'NEWS_API_KEY not set, skipping NewsAPI for stocks');
    return [];
  }

  return withRetry(async () => {
    const response = await axios.get(NEWSAPI_STOCKS_URL, {
      timeout: 15000,
      headers: { 'X-Api-Key': apiKey },
    });
    const articles = response.data?.articles || [];
    return articles.slice(0, 10).map((article: any) => ({
      title: article.title || '',
      url: article.url || '',
      source: article.source?.name || 'NewsAPI',
      category: 'indian-stocks' as const,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
      summary: truncate(article.description || '', 200),
    }));
  }, 2, 3000, 'NewsAPI stocks');
}

async function fetchRssFeed(feedUrl: string, sourceName: string): Promise<NewsItem[]> {
  return withRetry(async () => {
    const response = await axios.get(feedUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'NewsPulseBot/1.0' },
    });
    const parsed = xmlParser.parse(response.data);
    const items = parsed?.rss?.channel?.item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.slice(0, 8).map((item: any) => ({
      title: String(item.title || ''),
      url: String(item.link || ''),
      source: sourceName,
      category: 'indian-stocks' as const,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      summary: truncate(stripHtml(String(item.description || '')), 200),
    }));
  }, 2, 3000, `RSS ${sourceName}`);
}

function deduplicateByTitle(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.title.toLowerCase().trim().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
