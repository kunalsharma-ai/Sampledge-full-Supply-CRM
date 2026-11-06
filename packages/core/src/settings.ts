/**
 * SUPPLY360 workspace settings: the rules each value must meet, shared by the API (which enforces
 * them on save) and the web app (which checks them inline). Labels and help text live with the screen.
 *
 * `managedBy` marks settings whose record of truth is elsewhere; they are shown read-only on the
 * settings screen and changed where they live, so there is only one place to edit each value.
 */
export type SettingValue = string | number | boolean;
export type SettingRule = {
  id: string;
  kind: 'number' | 'toggle' | 'select' | 'text';
  default: SettingValue;
  min?: number; max?: number; options?: string[];
  managedBy?: { label: string; href: string };
};

export const settingRules: SettingRule[] = [
  { id: 'tenant.name', kind: 'text', default: 'Sampledge' },
  { id: 'tenant.timezone', kind: 'select', default: 'UTC', options: ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata'] },
  { id: 'locale.default', kind: 'select', default: 'en', options: ['en', 'de', 'fr', 'es', 'pt', 'it', 'ja'] },
  { id: 'locale.currency', kind: 'select', default: 'USD', options: ['USD', 'GBP', 'EUR', 'INR'] },
  { id: 'send.windowStart', kind: 'number', default: 8, min: 6, max: 12 },
  { id: 'send.windowEnd', kind: 'number', default: 21, min: 17, max: 23 },
  { id: 'send.weeklyCap', kind: 'number', default: 5, min: 1, max: 14, managedBy: { label: 'Panel reward policy', href: '/panels' } },
  { id: 'send.activeWithin', kind: 'number', default: 30, min: 7, max: 180 },
  { id: 'rewards.pointValue', kind: 'number', default: 100, min: 50, max: 1000, managedBy: { label: 'Finance', href: '/finance' } },
  { id: 'rewards.minRedeem', kind: 'number', default: 500, min: 100, max: 5000, managedBy: { label: 'Panel reward policy', href: '/panels' } },
  { id: 'rewards.expiry', kind: 'number', default: 18, min: 6, max: 36 },
  { id: 'rewards.autoHold', kind: 'number', default: 0.6, min: 0.3, max: 0.95 },
  { id: 'quality.speeder', kind: 'number', default: 40, min: 20, max: 60 },
  { id: 'quality.autoSuspend', kind: 'toggle', default: false },
  { id: 'privacy.retention', kind: 'number', default: 30, min: 7, max: 30 },
  { id: 'privacy.healthOnlyMatch', kind: 'toggle', default: true },
  { id: 'limits.apiRate', kind: 'number', default: 600, min: 60, max: 6000 },
];
export const settingRule = (id: string) => settingRules.find((r) => r.id === id);

/** Why a single value is not allowed, or null. `all` is the full set after the change, for cross-checks. */
export function settingError(id: string, v: unknown, all: Record<string, SettingValue>): string | null {
  const r = settingRule(id);
  if (!r) return 'Unknown setting';
  if (r.kind === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'Enter a number';
    if (r.min != null && v < r.min) return `At least ${r.min}`;
    if (r.max != null && v > r.max) return `At most ${r.max}`;
  }
  if (r.kind === 'toggle' && typeof v !== 'boolean') return 'Must be on or off';
  if (r.kind === 'select' && !r.options!.includes(String(v))) return `One of ${r.options!.join(', ')}`;
  if (r.kind === 'text' && (typeof v !== 'string' || !v.trim() || v.length > 120)) return typeof v === 'string' && v.length > 120 ? 'At most 120 characters' : 'Required';
  if (id === 'send.windowEnd' || id === 'send.windowStart') {
    if (Number(all['send.windowEnd']) - Number(all['send.windowStart']) < 6) return 'The window must be at least 6 hours long';
  }
  if (id === 'privacy.healthOnlyMatch' && v === false) return 'This can’t be turned off: MyHealthOpinions consent terms require it.';
  return null;
}
