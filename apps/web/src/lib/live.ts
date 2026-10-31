'use client';
/**
 * Data hooks for screens that exist only against the API (finance, comms, portals, feasibility).
 * Their records (invoices, POs, messages, supplier answers) are never simulated in offline mode.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useOS } from './store';

export function useLive<T>(path: string | null, deps: unknown[] = []) {
  const live = useOS((s) => s.mode === 'live' && !!s.session);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!live || !path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reach the API'); } finally { setLoading(false); }
  }, [live, path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: load, live };
}

/** Runs a write, toasts the outcome and returns the result (null on failure). */
export async function act<T>(fn: () => Promise<T>, ok: string | ((r: T) => string)): Promise<T | null> {
  const { toast } = useOS.getState();
  try {
    const r = await fn();
    toast(typeof ok === 'function' ? ok(r) : ok);
    void useOS.getState().refresh();
    return r;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not reach the API', 'warn');
    return null;
  }
}

export const shortDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export type Invoice = { id: string; number: string; clientId: string; clientName?: string; projectId: string; project?: { code: string; name: string }; completes: number; cpi: number; amount: number; status: 'draft' | 'issued' | 'paid' | 'void'; issuedAt?: string; dueAt?: string; paidAt?: string; createdAt: string };
export type Payable = { id: string; vendorId: string; vendorName?: string; purchaseOrderId: string; purchaseOrder: { number: string; projectId: string }; amount: number; status: 'open' | 'pending_approval' | 'paid'; dueAt: string; paidAt?: string };
export type PurchaseOrder = { id: string; number: string; vendorId: string; vendorName?: string; projectId: string; projectCode?: string; allocationId: string; completes: number; cpi: number; amount: number; status: string; issuedAt: string; payables: Payable[] };
export type FinanceSummary = { receivable: number; overdueReceivable: number; collected: number; draftInvoices: number; payable: number; paidOut: number; awaitingApproval: number; purchaseOrders: number; note: string };
export type Feasibility = { id: string; vendorId: string; vendorName?: string; country: string; audience: string; sampleSize: number; incidence: number; loi: number; status: 'sent' | 'responded' | 'declined'; dueAt: string; cpi?: number | null; capacity?: number | null; note?: string | null; respondedAt?: string | null; respondedBy?: string | null; reference?: string; createdAt: string };
export type Message = { id: string; channel: 'email' | 'sms' | 'in_app'; audience: string; toRef: string; recipients: number; subject: string; body: string; status: 'pending_approval' | 'queued' | 'delivered_dev' | 'failed' | 'cancelled'; adapter?: string | null; createdBy: string; createdAt: string; deliveredAt?: string | null; relatedType?: string | null };
export type Template = { id: string; key: string; name: string; channel: string; subject: string; body: string };
export type Allocation = { id: string; projectId: string; vendorId: string; completes: number; delivered?: number; cpi?: number; status: string };

export const messageTone: Record<Message['status'], 'emerald' | 'orange' | 'blue' | 'danger' | 'neutral'> = { delivered_dev: 'emerald', pending_approval: 'orange', queued: 'blue', failed: 'danger', cancelled: 'neutral' };
export const messageLabel: Record<Message['status'], string> = { delivered_dev: 'Recorded (dev adapter)', pending_approval: 'Awaiting approval', queued: 'Queued', failed: 'Failed', cancelled: 'Cancelled' };
export const fmtCpi = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);
