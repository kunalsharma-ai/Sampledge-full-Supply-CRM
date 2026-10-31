import { Prisma } from '@prisma/client';

/**
 * Event types written to the outbox. Payloads carry ids, not copies, so handlers always read
 * the committed state. Handlers live in modules/worker.ts and must be idempotent.
 */
export type EventType =
  | 'opportunity.won'
  | 'approval.requested'
  | 'approval.decided'
  | 'allocation.approved'
  | 'quote.sent'
  | 'survey.published'
  | 'project.stage_changed'
  | 'quota.filled'
  | 'feasibility.requested'
  | 'feasibility.responded'
  | 'invoice.issued'
  | 'payable.paid'
  | 'message.queued';

/** Writes an event in the caller's transaction: it exists only if the change commits. */
export function emit(tx: Prisma.TransactionClient, tenantId: string, type: EventType, payload: Record<string, unknown>) {
  return tx.outboxEvent.create({ data: { tenantId, type, payload: payload as Prisma.InputJsonValue } });
}
