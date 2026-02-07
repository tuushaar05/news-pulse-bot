import Anthropic from '@anthropic-ai/sdk';
import { NewsItem, VerifiedNewsItem } from '../types/index';
import { log, withRetry } from '../utils/helpers';
import { TIER_1_SOURCES } from '../config';

export class VerifierService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async verifyNews(items: NewsItem[]): Promise<VerifiedNewsItem[]> {
    if (items.length === 0) return [];

    try {
      return await withRetry(
        () => this.callClaude(items),
        2,
        5000,
        'Claude verification'
      );
    } catch (error) {
      log('error', 'Claude verification failed completely, using Tier 1 source fallback', {
        error: String(error),
        itemCount: items.length,
      });
      return this.fallbackVerification(items);
    }
  }

  private async callClaude(items: NewsItem[]): Promise<VerifiedNewsItem[]> {
    const itemList = items.map((item, index) =>
      `${index + 1}. [${item.category}] "${item.title}" (Source: ${item.source}, URL: ${item.url})`
    ).join('\n');

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a news authenticity evaluator. For each news item, evaluate:
1. Source Credibility (is this from a known, reputable outlet?)
2. Claim Plausibility (does the claim seem factually plausible?)
3. Red Flags (clickbait, unverified claims, sensationalism?)

Rate each item: PASS (include), UNCERTAIN (include with caveat), or FAIL (exclude).

Return ONLY a valid JSON array, no other text:
[{"index": 1, "verdict": "PASS", "reason": "brief reason"}, ...]`,
      messages: [{
        role: 'user',
        content: `Evaluate these ${items.length} news items:\n\n${itemList}`,
      }],
    });

    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    const verdicts = this.parseResponse(responseText, items.length);

    return items.map((item, index) => {
      const verdict = verdicts[index];
      if (verdict?.verdict === 'FAIL') {
        return { ...item, isVerified: false, verificationNote: verdict.reason };
      }
      if (verdict?.verdict === 'UNCERTAIN') {
        return { ...item, isVerified: true, verificationNote: `⚠️ Unverified: ${verdict.reason}` };
      }
      return { ...item, isVerified: true };
    });
  }

  private parseResponse(
    text: string,
    expectedCount: number
  ): Array<{ verdict: string; reason: string }> {
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        log('warn', 'Could not find JSON array in Claude response');
        return Array(expectedCount).fill({ verdict: 'PASS', reason: '' });
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      const indexed = new Map<number, { verdict: string; reason: string }>();
      for (const item of parsed) {
        indexed.set(item.index, {
          verdict: item.verdict || 'PASS',
          reason: item.reason || '',
        });
      }

      return Array.from({ length: expectedCount }, (_, i) =>
        indexed.get(i + 1) || { verdict: 'PASS', reason: '' }
      );
    } catch (error) {
      log('warn', 'Failed to parse Claude verification response', {
        error: String(error),
        responsePreview: text.substring(0, 300),
      });
      return Array(expectedCount).fill({ verdict: 'PASS', reason: '' });
    }
  }

  private fallbackVerification(items: NewsItem[]): VerifiedNewsItem[] {
    return items.map(item => {
      const isTier1 = TIER_1_SOURCES.some(
        src => item.source.toLowerCase().includes(src.toLowerCase())
      );
      return {
        ...item,
        isVerified: isTier1,
        verificationNote: isTier1 ? undefined : 'Excluded: verification unavailable, non-Tier 1 source',
      };
    });
  }
}
