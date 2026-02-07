import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NewsItem, VerifiedNewsItem, AIModelConfig } from '../types/index';
import { log, withRetry } from '../utils/helpers';
import { TIER_1_SOURCES } from '../config';

const SYSTEM_PROMPT = `You are a news authenticity evaluator. For each news item, evaluate:
1. Source Credibility (is this from a known, reputable outlet?)
2. Claim Plausibility (does the claim seem factually plausible?)
3. Red Flags (clickbait, unverified claims, sensationalism?)

Rate each item: PASS (include), UNCERTAIN (include with caveat), or FAIL (exclude).

Return ONLY a valid JSON array, no other text:
[{"index": 1, "verdict": "PASS", "reason": "brief reason"}, ...]`;

export class VerifierService {
  private modelConfig: AIModelConfig;
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;

  constructor(modelConfig: AIModelConfig) {
    this.modelConfig = modelConfig;

    switch (modelConfig.provider) {
      case 'claude':
        this.anthropicClient = new Anthropic({ apiKey: modelConfig.apiKey });
        break;
      case 'openai':
        this.openaiClient = new OpenAI({ apiKey: modelConfig.apiKey });
        break;
      case 'grok':
        this.openaiClient = new OpenAI({
          apiKey: modelConfig.apiKey,
          baseURL: modelConfig.baseUrl,
        });
        break;
    }

    log('info', `Verifier initialized with provider: ${modelConfig.provider}, model: ${modelConfig.model}`);
  }

  async verifyNews(items: NewsItem[]): Promise<VerifiedNewsItem[]> {
    if (items.length === 0) return [];

    try {
      return await withRetry(
        () => this.callAI(items),
        2,
        5000,
        `${this.modelConfig.provider} verification`
      );
    } catch (error) {
      log('error', `${this.modelConfig.provider} verification failed completely, using Tier 1 source fallback`, {
        error: String(error),
        itemCount: items.length,
      });
      return this.fallbackVerification(items);
    }
  }

  private async callAI(items: NewsItem[]): Promise<VerifiedNewsItem[]> {
    const userMessage = this.buildUserMessage(items);

    let responseText: string;

    switch (this.modelConfig.provider) {
      case 'claude':
        responseText = await this.callClaude(userMessage);
        break;
      case 'openai':
      case 'grok':
        responseText = await this.callOpenAICompatible(userMessage);
        break;
      default:
        throw new Error(`Unknown AI provider: ${this.modelConfig.provider}`);
    }

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

  private buildUserMessage(items: NewsItem[]): string {
    const itemList = items.map((item, index) =>
      `${index + 1}. [${item.category}] "${item.title}" (Source: ${item.source}, URL: ${item.url})`
    ).join('\n');

    return `Evaluate these ${items.length} news items:\n\n${itemList}`;
  }

  private async callClaude(userMessage: string): Promise<string> {
    if (!this.anthropicClient) throw new Error('Anthropic client not initialized');

    const response = await this.anthropicClient.messages.create({
      model: this.modelConfig.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');
  }

  private async callOpenAICompatible(userMessage: string): Promise<string> {
    if (!this.openaiClient) throw new Error('OpenAI client not initialized');

    const response = await this.openaiClient.chat.completions.create({
      model: this.modelConfig.model,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    return response.choices[0]?.message?.content || '';
  }

  private parseResponse(
    text: string,
    expectedCount: number
  ): Array<{ verdict: string; reason: string }> {
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        log('warn', 'Could not find JSON array in AI response');
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
      log('warn', 'Failed to parse AI verification response', {
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
