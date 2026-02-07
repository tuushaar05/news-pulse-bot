import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { NewsItem } from '../types/index';
import { hashString, normalizeUrl, normalizeTitle, log } from '../utils/helpers';

export class DeduplicationService {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS seen_news (
        hash TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        first_seen TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_first_seen ON seen_news(first_seen)
    `);

    this.save();
    log('info', 'Deduplication database initialized');
  }

  filterNew(items: NewsItem[]): NewsItem[] {
    if (!this.db || items.length === 0) return items;

    const newItems: NewsItem[] = [];

    for (const item of items) {
      const hash = this.computeHash(item);
      const result = this.db.exec('SELECT 1 FROM seen_news WHERE hash = ?', [hash]);
      if (result.length === 0 || result[0].values.length === 0) {
        this.db.run(
          'INSERT OR IGNORE INTO seen_news (hash, title, category, first_seen) VALUES (?, ?, ?, ?)',
          [hash, item.title, item.category, new Date().toISOString()]
        );
        newItems.push(item);
      }
    }

    this.save();
    log('info', `Dedup: ${items.length} items in, ${newItems.length} new`);
    return newItems;
  }

  private computeHash(item: NewsItem): string {
    const normalized = normalizeUrl(item.url);
    const title = normalizeTitle(item.title);
    return hashString(`${normalized}|${title}`);
  }

  cleanup(daysOld: number = 7): number {
    if (!this.db) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    this.db.run('DELETE FROM seen_news WHERE first_seen < ?', [cutoff.toISOString()]);

    const result = this.db.exec('SELECT changes()');
    const changes = result.length > 0 ? Number(result[0].values[0][0]) : 0;

    this.save();
    log('info', `Dedup cleanup: removed ${changes} entries older than ${daysOld} days`);
    return changes;
  }

  getStats(): { total: number; today: number } {
    if (!this.db) return { total: 0, today: 0 };

    const totalResult = this.db.exec('SELECT COUNT(*) FROM seen_news');
    const total = totalResult.length > 0 ? Number(totalResult[0].values[0][0]) : 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayResult = this.db.exec(
      'SELECT COUNT(*) FROM seen_news WHERE first_seen >= ?',
      [todayStart.toISOString()]
    );
    const today = todayResult.length > 0 ? Number(todayResult[0].values[0][0]) : 0;

    return { total, today };
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
