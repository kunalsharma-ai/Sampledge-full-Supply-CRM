/**
 * Provider-independent AI gateway.
 *
 * Every AI feature is a registered *task*: a versioned prompt, a typed output schema and a
 * rule-based implementation. The gateway picks a provider per call:
 *   - `rules` (default): deterministic code, no model, no data leaves the system;
 *   - `anthropic`: Claude via the official SDK, only when AI_PROVIDER=anthropic and credentials exist.
 * Model output is validated against the task schema; on a refusal, an error, an invalid result or a
 * spent monthly budget the gateway returns the rule-based result instead and says so.
 * Every run is logged to AiCall (provider, tokens, cost, outcome) and counted against the cap.
 * AI output is always a draft: nothing consequential happens without the existing approvals.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod/v4';
import type { Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';

export type AiTask<I, O> = {
  name: string;
  version: number;
  description: string;
  schema: z.ZodType<O>;
  system: string;
  render: (input: I) => string;
  rules: (input: I) => O;
  maxTokens?: number;
};

export type AiResult<O> = {
  data: O;
  provider: 'rules' | 'anthropic';
  model: string | null;
  status: 'ok' | 'fallback' | 'refused' | 'error' | 'cap_reached';
  note: string;
  costUsd: number;
};

/** Claude Opus 5.5 list prices, USD per million tokens. */
const PRICE = { input: 4, output: 20 };
export const AI_MODEL = 'claude-opus-5-5';

export function aiConfig() {
  const wanted = (process.env.AI_PROVIDER ?? 'rules').toLowerCase();
  const hasCreds = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return {
    provider: wanted === 'anthropic' && hasCreds ? ('anthropic' as const) : ('rules' as const),
    requested: wanted,
    capUsd: Number(process.env.AI_MONTHLY_CAP_USD ?? 50),
    note: wanted === 'anthropic' && !hasCreds ? 'AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY is set: using rules' : undefined,
  };
}

@Injectable()
export class AiGateway {
  private log = new Logger('AiGateway');
  private client: Anthropic | null = null;

  constructor(private db: PrismaService) {}

  private anthropic() {
    this.client ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
    return this.client;
  }

  async monthSpend(tenantId: string) {
    const from = new Date();
    from.setUTCDate(1);
    from.setUTCHours(0, 0, 0, 0);
    const r = await this.db.aiCall.aggregate({ where: { tenantId, createdAt: { gte: from } }, _sum: { costUsd: true }, _count: true });
    return { usd: r._sum.costUsd ?? 0, calls: r._count };
  }

  async run<I, O>(ctx: Ctx, task: AiTask<I, O>, input: I): Promise<AiResult<O>> {
    const cfg = aiConfig();
    const started = Date.now();
    const record = (r: AiResult<O>, extra: { inputTokens?: number; outputTokens?: number; error?: string } = {}) =>
      this.db.aiCall.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, task: task.name, provider: r.provider, model: r.model, status: r.status, costUsd: r.costUsd, ms: Date.now() - started, inputTokens: extra.inputTokens ?? 0, outputTokens: extra.outputTokens ?? 0, error: extra.error?.slice(0, 500) } });
    const fallback = (status: AiResult<O>['status'], note: string): AiResult<O> => ({ data: task.rules(input), provider: 'rules', model: null, status, note, costUsd: 0 });

    if (cfg.provider === 'rules') {
      const r = fallback('ok', cfg.note ?? 'Rule-based: no AI model is connected');
      await record(r);
      return r;
    }
    const spent = await this.monthSpend(ctx.tenantId);
    if (spent.usd >= cfg.capUsd) {
      const r = fallback('cap_reached', `Monthly AI budget of $${cfg.capUsd} reached: rule-based result`);
      await record(r);
      return r;
    }
    try {
      const msg = await this.anthropic().beta.messages.create({
        model: AI_MODEL,
        max_tokens: task.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: zodOutputFormat(task.schema) },
        system: task.system,
        messages: [{ role: 'user', content: task.render(input) }],
      });
      const inputTokens = msg.usage.input_tokens;
      const outputTokens = msg.usage.output_tokens;
      const costUsd = (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1_000_000;
      if (msg.stop_reason === 'refusal') {
        const r = { ...fallback('refused', 'The model declined this request: rule-based result'), costUsd };
        await record(r, { inputTokens, outputTokens, error: msg.stop_details?.category ?? 'refusal' });
        return r;
      }
      // Parsed here rather than with .parse() so refusals and truncated output fall back cleanly.
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* invalid JSON → fallback below */ }
      const check = parsed == null ? null : task.schema.safeParse(parsed);
      if (!check?.success) {
        const r = { ...fallback('fallback', 'Model output did not match the expected structure: rule-based result'), costUsd };
        await record(r, { inputTokens, outputTokens, error: msg.stop_reason === 'max_tokens' ? 'max_tokens' : 'invalid_output' });
        return r;
      }
      const r: AiResult<O> = { data: check.data, provider: 'anthropic', model: msg.model, status: 'ok', note: `Drafted by ${msg.model}. Review before use.`, costUsd };
      await record(r, { inputTokens, outputTokens });
      return r;
    } catch (e) {
      const kind = e instanceof Anthropic.RateLimitError ? 'rate_limited' : e instanceof Anthropic.AuthenticationError ? 'auth' : e instanceof Anthropic.APIError ? `api_${e.status}` : e instanceof Anthropic.APIConnectionError ? 'connection' : 'error';
      this.log.warn(`${task.name}: ${kind}`);
      const r = fallback('error', `AI provider unavailable (${kind}): rule-based result`);
      await record(r, { error: kind });
      return r;
    }
  }
}
