import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { NewsItem, CryptoPrice, CryptoCollectionResult } from '../types/index';
import { withRetry, log, truncate, stripHtml, cleanGoogleNewsTitle } from '../utils/helpers';

const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,inr&include_24hr_change=true';
const CRYPTOCOMPARE_NEWS_URL = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest';
const COINDESK_RSS = 'https://www.coindesk.com/feed/';
const COINTELEGRAPH_RSS = 'https://cointelegraph.com/rss';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export async function collectCryptoNews(): Promise<CryptoCollectionResult> {
  const errors: string[] = [];
  let price: CryptoPrice = { symbol: 'BTC', priceUsd: 0 };
  const allNews: NewsItem[] = [];

  const [priceResult, ...newsResults] = await Promise.allSettled([
    fetchBtcPrice(),
    fetchCryptoCompareNews(),
    fetchRssFeed(COINDESK_RSS, 'CoinDesk'),
    fetchRssFeed(COINTELEGRAPH_RSS, 'CoinTelegraph'),
    fetchGoogleCryptoNews(),
  ]);

  if (priceResult.status === 'fulfilled') {
    price = priceResult.value;
  } else {
    errors.push(`BTC price fetch failed: ${priceResult.reason}`);
    log('error', 'BTC price fetch failed', { error: String(priceResult.reason) });
  }

  for (const result of newsResults) {
    if (result.status === 'fulfilled') {
      allNews.push(...result.value);
    } else {
      errors.push(`Crypto news source failed: ${result.reason}`);
      log('warn', 'Crypto news source failed', { error: String(result.reason) });
    }
  }

  const unique = deduplicateByTitle(allNews);
  unique.sort((a, b) => {
    const dateA = a.publishedAt?.getTime() || 0;
    const dateB = b.publishedAt?.getTime() || 0;
    return dateB - dateA;
  });

  log('info', `[CRYPTO] Fetched ${allNews.length} raw items, ${unique.length} after local dedup`);

  return {
    price,
    news: unique.slice(0, 8),
    errors,
  };
}

async function fetchBtcPrice(): Promise<CryptoPrice> {
  return withRetry(async () => {
    const response = await axios.get(COINGECKO_PRICE_URL, { timeout: 10000 });
    const data = response.data;
    return {
      symbol: 'BTC',
      priceUsd: data.bitcoin.usd,
      priceInr: data.bitcoin.inr,
    };
  }, 3, 2000, 'CoinGecko BTC price');
}

async function fetchCryptoCompareNews(): Promise<NewsItem[]> {
  return withRetry(async () => {
    const response = await axios.get(CRYPTOCOMPARE_NEWS_URL, { timeout: 15000 });
    const articles = response.data?.Data || [];
    return articles.slice(0, 10).map((article: any) => ({
      title: article.title || '',
      url: article.url || '',
      source: article.source_info?.name || article.source || 'CryptoCompare',
      category: 'crypto' as const,
      publishedAt: article.published_on ? new Date(article.published_on * 1000) : undefined,
      summary: truncate(stripHtml(article.body || ''), 200),
    }));
  }, 2, 3000, 'CryptoCompare news');
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

    return itemArray.slice(0, 10).map((item: any) => ({
      title: String(item.title || ''),
      url: String(item.link || ''),
      source: sourceName,
      category: 'crypto' as const,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      summary: truncate(stripHtml(String(item.description || '')), 200),
    }));
  }, 2, 3000, `RSS ${sourceName}`);
}

async function fetchGoogleCryptoNews(): Promise<NewsItem[]> {
  return withRetry(async () => {
    const url = 'https://news.google.com/rss/search?q=bitcoin+crypto+cryptocurrency&hl=en&gl=US&ceid=US:en';
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'NewsPulseBot/1.0' },
    });
    const parsed = xmlParser.parse(response.data);
    const items = parsed?.rss?.channel?.item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.slice(0, 8).map((item: any) => {
      const { cleanTitle, source } = cleanGoogleNewsTitle(String(item.title || ''));
      return {
        title: cleanTitle,
        url: String(item.link || ''),
        source,
        category: 'crypto' as const,
        publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        summary: truncate(stripHtml(String(item.description || '')), 200),
      };
    });
  }, 2, 3000, 'Google News Crypto');
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
