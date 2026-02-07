import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { NewsItem, GeopoliticalCollectionResult } from '../types/index';
import { withRetry, log, truncate, stripHtml, cleanGoogleNewsTitle } from '../utils/helpers';

const BBC_WORLD_RSS = 'https://feeds.bbci.co.uk/news/world/rss.xml';
const ALJAZEERA_RSS = 'https://www.aljazeera.com/xml/rss/all.xml';
const GOOGLE_NEWS_GEO_QUERIES = [
  'world news today international',
  'geopolitics trade war sanctions',
];
const NEWSAPI_GEO_URL = 'https://newsapi.org/v2/top-headlines?category=general&language=en&pageSize=10';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export async function collectGeopoliticalNews(): Promise<GeopoliticalCollectionResult> {
  const errors: string[] = [];
  const allNews: NewsItem[] = [];

  const results = await Promise.allSettled([
    fetchRssFeed(BBC_WORLD_RSS, 'BBC World'),
    fetchRssFeed(ALJAZEERA_RSS, 'Al Jazeera'),
    ...GOOGLE_NEWS_GEO_QUERIES.map(q => fetchGoogleNewsRss(q)),
    fetchNewsApiGeo(),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allNews.push(...result.value);
    } else {
      errors.push(`Geopolitical news source failed: ${result.reason}`);
      log('warn', 'Geopolitical source failed', { error: String(result.reason) });
    }
  }

  const unique = deduplicateByTitle(allNews);
  unique.sort((a, b) => {
    const dateA = a.publishedAt?.getTime() || 0;
    const dateB = b.publishedAt?.getTime() || 0;
    return dateB - dateA;
  });

  log('info', `[GEO] Fetched ${allNews.length} raw items, ${unique.length} after local dedup`);

  return {
    news: unique.slice(0, 8),
    errors,
  };
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

    return itemArray.slice(0, 15).map((item: any) => ({
      title: String(item.title || ''),
      url: String(item.link || ''),
      source: sourceName,
      category: 'geopolitical' as const,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      summary: truncate(stripHtml(String(item.description || '')), 200),
    }));
  }, 2, 3000, `RSS ${sourceName}`);
}

async function fetchGoogleNewsRss(query: string): Promise<NewsItem[]> {
  return withRetry(async () => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'NewsPulseBot/1.0' },
    });
    const parsed = xmlParser.parse(response.data);
    const items = parsed?.rss?.channel?.item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.slice(0, 10).map((item: any) => {
      const { cleanTitle, source } = cleanGoogleNewsTitle(String(item.title || ''));
      return {
        title: cleanTitle,
        url: String(item.link || ''),
        source,
        category: 'geopolitical' as const,
        publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
        summary: truncate(stripHtml(String(item.description || '')), 200),
      };
    });
  }, 2, 3000, `Google News: ${query}`);
}

async function fetchNewsApiGeo(): Promise<NewsItem[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    log('warn', 'NEWS_API_KEY not set, skipping NewsAPI for geopolitical');
    return [];
  }

  return withRetry(async () => {
    const response = await axios.get(NEWSAPI_GEO_URL, {
      timeout: 15000,
      headers: { 'X-Api-Key': apiKey },
    });
    const articles = response.data?.articles || [];
    return articles.slice(0, 10).map((article: any) => ({
      title: article.title || '',
      url: article.url || '',
      source: article.source?.name || 'NewsAPI',
      category: 'geopolitical' as const,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
      summary: truncate(article.description || '', 200),
    }));
  }, 2, 3000, 'NewsAPI geopolitical');
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
