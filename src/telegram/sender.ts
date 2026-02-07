import { Bot } from 'grammy';
import { VerifiedNewsItem, StockQuote, CryptoPrice, MarketStatus } from '../types/index';
import { escapeHtml, log, sleep, formatISTDate, formatISTTime, truncate } from '../utils/helpers';

const TELEGRAM_MAX_LENGTH = 4096;

export class TelegramSender {
  private bot: Bot;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.bot = new Bot(botToken);
    this.chatId = chatId;
  }

  getBot(): Bot {
    return this.bot;
  }

  async sendNewsBulletin(
    cryptoPrice: CryptoPrice,
    cryptoNews: VerifiedNewsItem[],
    stockQuotes: StockQuote[],
    stockNews: VerifiedNewsItem[],
    geopoliticalNews: VerifiedNewsItem[],
    marketStatus: MarketStatus,
    errors: string[]
  ): Promise<void> {
    const header = this.buildHeader();
    const cryptoSection = this.buildCryptoSection(cryptoPrice, cryptoNews);
    const stockSection = this.buildStockSection(stockQuotes, stockNews, marketStatus);
    const geoSection = this.buildGeopoliticalSection(geopoliticalNews);
    const footer = this.buildFooter();

    const fullMessage = [header, cryptoSection, stockSection, geoSection, footer].join('\n\n');

    if (fullMessage.length <= TELEGRAM_MAX_LENGTH) {
      await this.sendHtml(fullMessage);
    } else {
      // Send each section separately
      const sections = [
        header + '\n\n' + cryptoSection,
        stockSection,
        geoSection + '\n\n' + footer,
      ];
      for (const section of sections) {
        if (section.trim()) {
          if (section.length <= TELEGRAM_MAX_LENGTH) {
            await this.sendHtml(section);
          } else {
            const chunks = this.splitAtLines(section);
            for (const chunk of chunks) {
              await this.sendHtml(chunk);
              await sleep(500);
            }
          }
          await sleep(500);
        }
      }
    }

    if (errors.length > 0) {
      try {
        await this.sendHtml(`<i>Note: ${errors.length} data source(s) had issues.</i>`);
      } catch {
        // Silently ignore
      }
    }

    log('info', 'News bulletin sent successfully');
  }

  private buildHeader(): string {
    const date = formatISTDate();
    const time = formatISTTime();
    return `📰 <b>NEWS PULSE</b> | ${escapeHtml(date)} | ${escapeHtml(time)} IST\n━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  private buildCryptoSection(price: CryptoPrice, news: VerifiedNewsItem[]): string {
    const verified = news.filter(n => n.isVerified);
    const priceStr = price.priceUsd > 0
      ? `$${price.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'N/A';
    const inrStr = price.priceInr
      ? ` (₹${price.priceInr.toLocaleString('en-IN')})`
      : '';

    let html = `🪙 <b>CRYPTO</b>\n\n`;
    html += `💰 <b>BTC:</b> ${priceStr}${inrStr}\n\n`;

    if (verified.length > 0) {
      html += this.formatNewsList(verified.slice(0, 5));
    } else {
      html += '<i>No verified crypto news available.</i>';
    }

    return html;
  }

  private buildStockSection(quotes: StockQuote[], news: VerifiedNewsItem[], marketStatus: MarketStatus): string {
    const verified = news.filter(n => n.isVerified);

    let html = `━━━━━━━━━━━━━━━━━━━━━━━━\n🇮🇳 <b>INDIAN MARKET</b>\n\n`;

    const statusEmoji = marketStatus.isOpen ? '🟢' : '🔴';
    html += `📊 ${statusEmoji} <i>${escapeHtml(marketStatus.nextOpenDescription)}</i>\n\n`;

    if (quotes.length > 0) {
      for (const q of quotes) {
        const changeSign = q.change >= 0 ? '+' : '';
        const emoji = q.change >= 0 ? '🟢' : '🔴';
        html += `${emoji} <b>${escapeHtml(q.name)}</b>: ₹${q.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${changeSign}${q.changePercent.toFixed(2)}%)\n`;
      }
      html += '\n';
    }

    if (verified.length > 0) {
      html += this.formatNewsList(verified.slice(0, 10));
    } else if (!marketStatus.isWeekend) {
      html += '<i>No verified market news available.</i>';
    }

    return html;
  }

  private buildGeopoliticalSection(news: VerifiedNewsItem[]): string {
    const verified = news.filter(n => n.isVerified);

    let html = `━━━━━━━━━━━━━━━━━━━━━━━━\n🌍 <b>GLOBAL NEWS</b>\n\n`;

    if (verified.length > 0) {
      html += this.formatNewsList(verified.slice(0, 5));
    } else {
      html += '<i>No verified geopolitical news available.</i>';
    }

    return html;
  }

  private buildFooter(): string {
    return `━━━━━━━━━━━━━━━━━━━━━━━━\n⏱️ ~5 min read | Verified by AI`;
  }

  private formatNewsList(items: VerifiedNewsItem[]): string {
    return items.map((item, i) => {
      const title = escapeHtml(truncate(item.title, 150));
      const source = escapeHtml(item.source);
      const note = item.verificationNote && item.verificationNote.startsWith('⚠️')
        ? `\n   ${escapeHtml(item.verificationNote)}`
        : '';
      let summary = '';
      if (item.summary && item.summary.length > 10) {
        summary = `\n   ${escapeHtml(truncate(item.summary, 120))}`;
      }
      return `${i + 1}. <a href="${escapeHtml(item.url)}">${title}</a>${summary}\n   <i>${source}</i>${note}`;
    }).join('\n\n');
  }

  private splitAtLines(html: string): string[] {
    const lines = html.split('\n');
    const chunks: string[] = [];
    let current = '';

    for (const line of lines) {
      if (current.length + line.length + 1 > TELEGRAM_MAX_LENGTH) {
        if (current) chunks.push(current.trim());
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  async sendHtml(html: string): Promise<void> {
    await this.bot.api.sendMessage(this.chatId, html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  async sendStartupMessage(): Promise<void> {
    const time = formatISTTime();
    await this.sendHtml(`🤖 <b>News Pulse Bot started</b>\n⏰ ${escapeHtml(time)} IST\n\nScheduled: 10:00 AM & 8:00 PM IST daily.\nUse /health to check status.`);
  }
}
