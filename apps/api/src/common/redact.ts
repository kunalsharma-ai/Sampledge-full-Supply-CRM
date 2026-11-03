import { can } from '@sampledge/core';
import type { Ctx } from './context';

/** Internal commercial fields. Removed server-side for roles without view:margins. */
const MARGIN_FIELDS = ['margin', 'cpiCost', 'costIncurred', 'budget'] as const;
/** Vendor rate cards and payables. Removed for roles without view:vendor_bids (except a vendor's own record). */
const VENDOR_FIELDS = ['cpiB2C', 'cpiB2B', 'cpiHC', 'pendingPayment', 'bidWinRate'] as const;

export function redactMargins<T extends Record<string, unknown>>(ctx: Ctx, row: T): T {
  if (can(ctx.role, 'view:margins')) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of MARGIN_FIELDS) if (f in out) delete out[f];
  if (Array.isArray(out.quotes)) out.quotes = (out.quotes as Record<string, unknown>[]).map((q) => redactMargins(ctx, q));
  // Clients never see which suppliers deliver their sample.
  if (ctx.role === 'client' && Array.isArray(out.allocations)) out.allocations = [];
  else if (Array.isArray(out.allocations)) out.allocations = (out.allocations as Record<string, unknown>[]).map((a) => redactAllocation(ctx, a));
  return out as T;
}

export function redactVendor<T extends Record<string, unknown>>(ctx: Ctx, v: T): T {
  if (can(ctx.role, 'view:vendor_bids') || (ctx.vendorId && v.id === ctx.vendorId)) return v;
  const out: Record<string, unknown> = { ...v };
  for (const f of VENDOR_FIELDS) delete out[f];
  return out as T;
}

/** Allocation cost is a vendor bid: visible to bid viewers and to the vendor it belongs to. */
export function redactAllocation<T extends Record<string, unknown>>(ctx: Ctx, a: T): T {
  if (can(ctx.role, 'view:vendor_bids') || (ctx.vendorId && a.vendorId === ctx.vendorId)) return a;
  const { cpi: _cpi, ...rest } = a;
  return rest as unknown as T;
}
