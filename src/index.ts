import cron from 'node-cron';
import { config } from './config';
import { collectCryptoNews } from './collectors/crypto';
import { collectIndianStockNews } from './collectors/indian-stocks';
import { collectGeopoliticalNews } from './collectors/geopolitical';
import { DeduplicationService } from './services/deduplication';
import { VerifierService } from './services/verifier';
import { getIndianMarketStatus } from './services/market-status';
import { TelegramSender } from './telegram/sender';
import { NewsItem, VerifiedNewsItem } from './types/index';
import { log } from './utils/helpers';

const dedup = new DeduplicationService(config.dbPath);
const verifier = new VerifierService(config.aiModel);
const sender = new TelegramSender(config.telegramBotToken, config.telegramChatId);
const bot = sender.getBot();

let lastSuccessfulSend: Date | null = null;
const startTime = new Date();

bot.command('health', async (ctx) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const stats = dedup.getStats();
  const lastSend = lastSuccessfulSend
    ? lastSuccessfulSend.toISOString()
    : 'Never';

  await ctx.reply(
    [
      `🤖 News Pulse Bot - Health Check`,
      ``,
      `⏱️ Uptime: ${hours}h ${minutes}m`,
      `📅 Started: ${startTime.toISOString()}`,
      `📨 Last send: ${lastSend}`,
      `🗄️ DB entries: ${stats.total} total, ${stats.today} today`,
      `⏰ Schedule: ${config.cronScheduleMorning} & ${config.cronScheduleEvening} (${config.timezone})`,
      `🤖 AI: ${config.aiModel.provider} (${config.aiModel.model})`,
      `🟢 Node: ${process.version}`,
    ].join('\n'),
  );
});

async function runNewsPipeline(): Promise<void> {
  const pipelineStart = Date.now();
  log('info', '========== Starting news pipeline ==========');

  try {
    // Step 1: Collect from all sources in parallel
    log('info', 'Collecting news from all sources...');
    const [cryptoResult, stockResult, geopoliticalResult] = await Promise.allSettled([
      collectCryptoNews(),
      collectIndianStockNews(),
      collectGeopoliticalNews(),
    ]);

    const crypto = cryptoResult.status === 'fulfilled'
      ? cryptoResult.value
      : { price: { symbol: 'BTC', priceUsd: 0 }, news: [] as NewsItem[], errors: ['Crypto collector crashed: ' + cryptoResult.reason] };

    const stocks = stockResult.status === 'fulfilled'
      ? stockResult.value
      : { quotes: [], news: [] as NewsItem[], isWeekend: false, errors: ['Stock collector crashed: ' + stockResult.reason] };

    const geopolitical = geopoliticalResult.status === 'fulfilled'
      ? geopoliticalResult.value
      : { news: [] as NewsItem[], errors: ['Geopolitical collector crashed: ' + geopoliticalResult.reason] };

    const allErrors = [...crypto.errors, ...stocks.errors, ...geopolitical.errors];

    log('info', 'Collection complete', {
      cryptoNews: crypto.news.length,
      stockNews: stocks.news.length,
      geoNews: geopolitical.news.length,
      stockQuotes: stocks.quotes.length,
      errors: allErrors.length,
    });

    // Step 2: Deduplication
    log('info', 'Running deduplication...');
    const newCryptoNews = crypto.news.length > 0 ? dedup.filterNew(crypto.news) : [];
    const newStockNews = stocks.news.length > 0 ? dedup.filterNew(stocks.news) : [];
    const newGeoNews = geopolitical.news.length > 0 ? dedup.filterNew(geopolitical.news) : [];

    // Step 3: Verify all news in a single Claude call
    const allNewNews: NewsItem[] = [...newCryptoNews, ...newStockNews, ...newGeoNews];
    let verifiedItems: VerifiedNewsItem[] = [];

    if (allNewNews.length > 0) {
      log('info', `Verifying ${allNewNews.length} news items with ${config.aiModel.provider} (${config.aiModel.model})...`);
      verifiedItems = await verifier.verifyNews(allNewNews);
    } else {
      log('info', 'No new news items to verify');
    }

    // Step 4: Split verified items back by category
    const verifiedCrypto = verifiedItems.filter(i => i.category === 'crypto');
    const verifiedStocks = verifiedItems.filter(i => i.category === 'indian-stocks');
    const verifiedGeo = verifiedItems.filter(i => i.category === 'geopolitical');

    log('info', 'Verification complete', {
      cryptoVerified: verifiedCrypto.filter(i => i.isVerified).length,
      stocksVerified: verifiedStocks.filter(i => i.isVerified).length,
      geoVerified: verifiedGeo.filter(i => i.isVerified).length,
    });

    // Step 5: Get market status
    const marketStatus = getIndianMarketStatus();

    // Step 6: Send via Telegram
    log('info', 'Sending Telegram message...');
    await sender.sendNewsBulletin(
      crypto.price,
      verifiedCrypto,
      stocks.quotes,
      verifiedStocks,
      verifiedGeo,
      marketStatus,
      allErrors,
    );

    lastSuccessfulSend = new Date();

    // Step 7: Periodic cleanup
    dedup.cleanup(7);

    const duration = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    log('info', `========== Pipeline completed in ${duration}s ==========`);
  } catch (error) {
    log('error', 'Pipeline failed', { error: String(error) });
    try {
      await sender.sendHtml(
        `⚠️ <b>News Pipeline Error</b>\n<pre>${String(error).substring(0, 500)}</pre>`
      );
    } catch {
      log('error', 'Failed to send error notification to Telegram');
    }
  }
}

async function main(): Promise<void> {
  log('info', 'news-pulse-bot starting...');

  // Initialize dedup database
  await dedup.initialize();

  const isTestSend = process.argv.includes('--test-send');

  if (isTestSend) {
    log('info', '>>> Running in --test-send mode (immediate execution) <<<');
    await runNewsPipeline();
    dedup.close();
    process.exit(0);
  }

  // Send startup notification
  try {
    await sender.sendStartupMessage();
  } catch (error) {
    log('error', 'Failed to send startup message', { error: String(error) });
  }

  // Schedule cron jobs
  cron.schedule(config.cronScheduleMorning, () => {
    runNewsPipeline().catch(err =>
      log('error', 'Morning pipeline error', { error: String(err) })
    );
  }, { timezone: config.timezone });

  cron.schedule(config.cronScheduleEvening, () => {
    runNewsPipeline().catch(err =>
      log('error', 'Evening pipeline error', { error: String(err) })
    );
  }, { timezone: config.timezone });

  log('info', `Cron scheduled: ${config.cronScheduleMorning} and ${config.cronScheduleEvening} (${config.timezone})`);

  // Start bot polling for /health command
  bot.start();
  log('info', 'Bot polling started. Waiting for scheduled runs...');

  // Graceful shutdown
  const shutdown = () => {
    log('info', 'Shutting down...');
    bot.stop();
    dedup.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  log('error', 'Fatal error during startup', { error: String(err) });
  process.exit(1);
});
