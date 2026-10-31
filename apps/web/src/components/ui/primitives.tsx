'use client';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, FlaskConical, Inbox, Search, X } from 'lucide-react';
import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ───────────────────────── Panel
export function Panel({ className, children, as: As = 'section', interactive, ...rest }: React.HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article'; interactive?: boolean }) {
  return (
    <As
      className={cn('panel p-5', interactive && 'transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-lift', className)}
      {...rest}
    >
      {children}
    </As>
  );
}

export function PanelHeader({ title, eyebrow, actions, className, info }: { title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; className?: string; info?: string }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink" title={info}>{title}</h2>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────────────────── Button
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'subtle' | 'danger'; size?: 'sm' | 'md' | 'icon' };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ className, variant = 'outline', size = 'md', ...p }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-4 text-[13px]',
        size === 'icon' && 'h-9 w-9',
        variant === 'primary' && 'bg-gradient-to-r from-blue to-purple text-white shadow-glow hover:brightness-110 active:scale-[.98]',
        variant === 'outline' && 'border hairline bg-surface-2/40 text-ink hover:border-blue/50 hover:bg-surface-2/80',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2/70 hover:text-ink',
        variant === 'subtle' && 'bg-blue/10 text-blue hover:bg-blue/20',
        variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
        className,
      )}
      {...p}
    />
  );
});

// ───────────────────────── Badge / status
const tones = {
  blue: 'bg-blue/10 text-blue ring-blue/25',
  cyan: 'bg-cyan/10 text-cyan ring-cyan/25',
  purple: 'bg-purple/10 text-purple ring-purple/25',
  emerald: 'bg-emerald/10 text-emerald ring-emerald/25',
  orange: 'bg-orange/10 text-orange ring-orange/25',
  magenta: 'bg-magenta/10 text-magenta ring-magenta/25',
  danger: 'bg-danger/10 text-danger ring-danger/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  neutral: 'bg-ink-3/10 text-ink-2 ring-ink-3/20',
} as const;
export type Tone = keyof typeof tones;
export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Mandatory on every simulated surface: makes demo data unmistakable. */
export function DemoBadge({ label = 'Demo data', className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-dashed border-orange/50 bg-orange/10 px-2 py-0.5 text-2xs font-semibold text-orange', className)} title="Fictional demonstration data. Not connected to live systems.">
      <FlaskConical size={11} /> {label}
    </span>
  );
}

// ───────────────────────── Segmented control
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md'; className?: string; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-xl border hairline bg-surface-2/40 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative rounded-[10px] font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-2xs' : 'px-3 py-1.5 text-xs',
            value === o.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {value === o.value && <motion.span layoutId={`seg-${label ?? 'x'}`} className="absolute inset-0 rounded-[10px] bg-surface shadow-panel ring-1 ring-inset ring-blue/30" transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Search
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cn('flex h-9 items-center gap-2 rounded-xl border hairline bg-surface-2/40 px-3 text-sm focus-within:border-blue/60', className)}>
      <Search size={14} className="text-ink-3" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
      {value && <button aria-label="Clear search" onClick={() => onChange('')}><X size={13} className="text-ink-3" /></button>}
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-ink-3">{hint}</span>}
    </label>
  );
}
export const inputCls = 'h-9 w-full rounded-xl border hairline bg-surface-2/40 px-3 text-[13px] text-ink outline-none focus:border-blue/60';

// ───────────────────────── States
export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed hairline px-6 py-10 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue/10 text-blue">{icon ?? <Inbox size={18} />}</div>
      <div className="font-display text-sm font-semibold">{title}</div>
      {body && <p className="max-w-sm text-xs text-ink-3">{body}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ title = 'Something went wrong', body, onRetry }: { title?: string; body?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-8 text-center">
      <AlertTriangle className="text-danger" size={20} />
      <div className="font-display text-sm font-semibold">{title}</div>
      {body && <p className="max-w-sm text-xs text-ink-3">{body}</p>}
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

// ───────────────────────── Progress ring
export function ProgressRing({ value, size = 64, stroke = 6, color = 'rgb(var(--cyan))', label, sub }: { value: number; size?: number; stroke?: number; color?: string; label?: ReactNode; sub?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line) / var(--line-alpha))" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <div>
          <div className="num font-jakarta text-[13px] font-bold">{label ?? `${Math.round(v * 100)}%`}</div>
          {sub && <div className="text-[9px] text-ink-3">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

export function Bar({ value, tone = 'blue', className }: { value: number; tone?: 'blue' | 'cyan' | 'emerald' | 'orange' | 'danger' | 'purple'; className?: string }) {
  const bg = { blue: 'bg-blue', cyan: 'bg-cyan', emerald: 'bg-emerald', orange: 'bg-orange', danger: 'bg-danger', purple: 'bg-purple' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ink-3/15', className)}>
      <motion.div className={cn('h-full rounded-full', bg)} initial={{ width: 0 }} animate={{ width: `${Math.min(100, value * 100)}%` }} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} />
    </div>
  );
}

// ───────────────────────── Drawer (side sheet)
export function Drawer({ open, onClose, title, children, width = 480, subtitle }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-bg/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog" aria-modal aria-label={typeof title === 'string' ? title : 'Details'}
            className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l hairline bg-bg-2/95 shadow-lift backdrop-blur-xl"
            style={{ maxWidth: width }}
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', bounce: 0.1, duration: 0.45 }}
          >
            <div className="flex items-start justify-between gap-3 border-b hairline px-6 py-5">
              <div>
                <div className="font-display text-lg font-semibold">{title}</div>
                {subtitle && <div className="mt-0.5 text-xs text-ink-3">{subtitle}</div>}
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X size={16} /></Button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────── Page header
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-2 flex items-center gap-2">{eyebrow}</div>}
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="text-2xs font-medium text-ink-3">{label}</div>
      <div className="num font-jakarta text-lg font-bold">{value}</div>
      {sub && <div className={cn('text-2xs', tone === 'up' ? 'text-emerald' : tone === 'down' ? 'text-danger' : 'text-ink-3')}>{sub}</div>}
    </div>
  );
}
