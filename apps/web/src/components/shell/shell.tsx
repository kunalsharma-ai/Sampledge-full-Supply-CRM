'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell, Bot, Building2, ChartScatter, ChevronsLeft, Command, Database, Globe2, KanbanSquare, Landmark, Lock, MessagesSquare,
  LogOut, Monitor, Moon, Orbit, Palette, Plug, RotateCcw, ShieldCheck, Sparkles, Sun, Target, Truck, Users, Workflow, Zap, ZapOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { isBuilt, modules } from '@/lib/modules';
import { access, roles } from '@/lib/core';
import { demoLoginsEnabled } from '@/lib/api';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Badge, Button, DemoBadge, Skeleton } from '@/components/ui/primitives';
import { Assistant } from './assistant';
import { CommandPalette } from './command-palette';
import { Logo } from './logo';
import { LiveBridge } from './live';

export const icons: Record<string, LucideIcon> = {
  Orbit, KanbanSquare, Bot, MessagesSquare, Workflow, Users, Database, ChartScatter, Sparkles, Target, Globe2, Landmark, Building2, Truck, Plug, ShieldCheck, Palette,
};

function ThemeSync() {
  const theme = useOS((s) => s.theme);
  const motionPref = useOS((s) => s.motion);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
      root.dataset.theme = resolved;
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.motion = motionPref;
  }, [motionPref]);
  return null;
}

function Sidebar({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const path = usePathname();
  const role = useOS((s) => s.role);
  const groups = ['Operate', 'Research', 'Commercial', 'Platform'] as const;
  return (
    <aside className={cn('sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r hairline bg-bg/70 backdrop-blur-xl transition-[width] duration-300 lg:flex', collapsed ? 'w-[76px]' : 'w-[248px]')}>
      <div className="flex h-16 items-center gap-2 px-5">
        <Logo compact={collapsed} />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2" aria-label="Modules">
        {groups.map((g) => {
          const items = modules.filter((m) => m.group === g && access(role, m.id) !== 'none');
          if (!items.length) return null;
          return (
            <div key={g}>
              {!collapsed && <div className="eyebrow mb-1.5 px-3">{g}</div>}
              <ul className="space-y-0.5">
                {items.map((m) => {
                  const Icon = icons[m.icon];
                  const active = path?.startsWith(m.href);
                  return (
                    <li key={m.id}>
                      <Link
                        href={m.href}
                        title={collapsed ? m.label : undefined}
                        className={cn(
                          'group relative flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors',
                          active ? 'text-ink' : 'text-ink-2 hover:bg-surface-2/50 hover:text-ink',
                        )}
                      >
                        {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue/20 via-purple/10 to-transparent ring-1 ring-inset ring-blue/25" transition={{ type: 'spring', bounce: 0.15, duration: 0.5 }} />}
                        {active && <span className="absolute left-0 top-2 h-5 w-[3px] rounded-r bg-cyan shadow-[0_0_12px_rgb(var(--cyan))]" />}
                        <Icon size={17} className={cn('relative shrink-0', active ? 'text-cyan' : 'text-ink-3 group-hover:text-ink-2')} />
                        {!collapsed && <span className="relative flex-1 truncate">{m.label}</span>}
                        {!collapsed && !isBuilt(m) && <span className="relative text-[9px] font-semibold uppercase tracking-wider text-ink-3">Planned</span>}
                        {!collapsed && access(role, m.id) === 'read' && <Lock size={11} className="relative text-ink-3" aria-label="Read only" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t hairline p-3">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCollapsed(!collapsed)} aria-label="Collapse sidebar">
          <ChevronsLeft size={15} className={cn('transition-transform', collapsed && 'rotate-180')} />
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  );
}

function ThemeSwitch() {
  const theme = useOS((s) => s.theme);
  const setTheme = useOS((s) => s.setTheme);
  const opts = [
    { v: 'dark' as const, icon: Moon, label: 'Premium Dark' },
    { v: 'light' as const, icon: Sun, label: 'Executive Light' },
    { v: 'system' as const, icon: Monitor, label: 'Adaptive System' },
  ];
  return (
    <div className="flex rounded-xl border hairline bg-surface-2/40 p-0.5" role="radiogroup" aria-label="Theme">
      {opts.map(({ v, icon: I, label }) => (
        <button key={v} role="radio" aria-checked={theme === v} title={label} onClick={() => setTheme(v)}
          className={cn('grid h-7 w-7 place-items-center rounded-[9px] transition-colors', theme === v ? 'bg-surface text-cyan shadow-panel' : 'text-ink-3 hover:text-ink')}>
          <I size={14} />
        </button>
      ))}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const n = useOS((s) => s.notifications);
  const markAll = useOS((s) => s.markAllRead);
  const markRead = useOS((s) => s.markRead);
  const unread = n.filter((x) => !x.read).length;
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen(!open)}>
        <Bell size={16} />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-magenta px-1 text-[9px] font-bold text-white">{unread}</span>}
      </Button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
              className="panel absolute right-0 top-11 z-50 w-[360px] p-0">
              <div className="flex items-center justify-between border-b hairline px-4 py-3">
                <div className="font-display text-sm font-semibold">Notification center</div>
                <div className="flex items-center gap-2"><DemoBadge /><button className="text-2xs text-cyan" onClick={markAll}>Mark all read</button></div>
              </div>
              <ul className="max-h-[380px] overflow-y-auto">
                {n.map((x) => (
                  <li key={x.id} className="border-b hairline px-4 py-3 last:border-0">
                    <Link href={`/${x.module}`} onClick={() => { markRead(x.id); setOpen(false); }} className="flex gap-3">
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.read ? 'bg-ink-3/30' : 'bg-cyan shadow-[0_0_8px_rgb(var(--cyan))]')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{x.title}</span>
                        <span className="block truncate text-2xs text-ink-3">{x.body}</span>
                      </span>
                      <span className="text-2xs text-ink-3">{x.time}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Topbar() {
  const role = useOS((s) => s.role);
  const setRole = useOS((s) => s.setRole);
  const motionPref = useOS((s) => s.motion);
  const setMotion = useOS((s) => s.setMotion);
  const setPalette = useOS((s) => s.setPalette);
  const setAssistant = useOS((s) => s.setAssistant);
  const reset = useOS((s) => s.resetDemo);
  const mode = useOS((s) => s.mode);
  const session = useOS((s) => s.session);
  const signOut = useOS((s) => s.signOut);
  const router = useRouter();
  const persona = roles.find((r) => r.id === role)!;
  const who = session?.user.name ?? persona.persona;
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b hairline bg-bg/60 px-4 backdrop-blur-xl md:px-6">
      <div className="lg:hidden"><Logo compact /></div>
      <button onClick={() => setPalette(true)} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border hairline bg-surface-2/40 px-3 text-left text-[13px] text-ink-3 transition-colors hover:border-blue/40 md:max-w-md">
        <Command size={14} className="shrink-0" /> <span className="flex-1 truncate"><span className="md:hidden">Search…</span><span className="hidden md:inline">Search projects, vendors, surveys, actions…</span></span>
        <kbd className="hidden rounded-md border hairline px-1.5 text-2xs md:inline">⌘K</kbd>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
        {mode === 'live'
          ? <span className="hidden items-center gap-1.5 md:inline-flex" title={`Signed in to ${session?.tenant.name}. Records are stored in Postgres; seeded records are fictional demo data.`}><Badge tone="emerald" dot>Live API</Badge><DemoBadge label="Demo data" /></span>
          : <span title="The API is not reachable. Records are the seeded demo set, kept only in this browser."><DemoBadge className="hidden md:inline-flex" label="Offline demo" /></span>}
        {mode === 'offline' && <Button variant="ghost" size="icon" className="hidden md:inline-flex" title="Reset demo data" aria-label="Reset demo data" onClick={reset}><RotateCcw size={15} /></Button>}
        <Button variant="ghost" size="icon" className="hidden md:inline-flex" title={motionPref === 'full' ? 'Reduce motion' : 'Enable motion'} aria-label="Toggle reduced motion" aria-pressed={motionPref === 'reduced'} onClick={() => setMotion(motionPref === 'full' ? 'reduced' : 'full')}>
          {motionPref === 'full' ? <Zap size={15} /> : <ZapOff size={15} />}
        </Button>
        <div className="hidden md:block"><ThemeSwitch /></div>
        <Notifications />
        <Button variant="subtle" size="sm" onClick={() => setAssistant(true)} className="hidden sm:inline-flex"><Sparkles size={14} /> Ask Sampledge AI</Button>
        <label className="flex items-center gap-2 rounded-xl border hairline bg-surface-2/40 py-1 pl-1 pr-2" title={session ? `${session.user.name} · ${session.user.email}` : 'Viewing as role (offline demo)'}>
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-blue to-purple text-2xs font-bold text-white">{who.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
          <span className="sr-only">{mode === 'live' ? 'Signed in as role' : 'Viewing as role'}</span>
          {mode === 'live' && !demoLoginsEnabled
            ? <span className="max-w-[150px] truncate text-xs font-medium">{persona.label}</span>
            : <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="max-w-[92px] bg-transparent md:max-w-[150px] text-xs font-medium text-ink outline-none" aria-label={mode === 'live' ? 'Switch demo account' : 'Switch role'}>
                {roles.map((r) => <option key={r.id} value={r.id} className="bg-bg-2">{r.label}</option>)}
              </select>}
        </label>
        {mode === 'live' && <Button variant="ghost" size="icon" title="Sign out" aria-label="Sign out" onClick={async () => { await signOut(); router.replace('/login'); }}><LogOut size={15} /></Button>}
      </div>
    </header>
  );
}

function MobileNav() {
  const path = usePathname();
  const role = useOS((s) => s.role);
  const items = modules.filter((m) => isBuilt(m) && m.id !== 'design-system' && access(role, m.id) !== 'none');
  return (
    <nav aria-label="Modules" className="sticky top-16 z-10 flex gap-1 overflow-x-auto border-b hairline bg-bg/70 px-3 py-2 backdrop-blur-xl lg:hidden">
      {items.map((m) => {
        const Icon = icons[m.icon];
        return (
          <Link key={m.id} href={m.href} className={cn('flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium', path?.startsWith(m.href) ? 'bg-blue/15 text-ink' : 'text-ink-3')}>
            <Icon size={13} /> {m.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Toaster() {
  const toasts = useOS((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
            className="panel pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-[13px]">
            <span className={cn('h-2 w-2 rounded-full', t.tone === 'warn' ? 'bg-warn' : t.tone === 'info' ? 'bg-cyan' : 'bg-emerald')} /> {t.title}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ModuleGuard({ children }: { children: ReactNode }) {
  const path = usePathname();
  const role = useOS((s) => s.role);
  const router = useRouter();
  const mod = useMemo(() => modules.find((m) => path?.startsWith(m.href)), [path]);
  if (mod && access(role, mod.id) === 'none') {
    const first = modules.find((m) => access(role, m.id) !== 'none' && isBuilt(m));
    return (
      <div className="mx-auto mt-24 max-w-md text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-danger/10 text-danger"><Lock size={20} /></div>
        <h1 className="font-display text-xl font-semibold">{mod.label} is not available to {roles.find((r) => r.id === role)!.label}</h1>
        <p className="mt-2 text-sm text-ink-3">The role matrix hides this module for your role, and the API refuses its endpoints for this role too.</p>
        {first && <Button variant="primary" className="mt-5" onClick={() => router.push(first.href)}>Go to {first.label}</Button>}
      </div>
    );
  }
  return <>{children}</>;
}

/** Routes rendered without the app chrome: sign-in and the public respondent runtime. */
const bare = (path: string | null) => !!path && (path === '/login' || path.startsWith('/r/'));

export function Shell({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const mode = useOS((s) => s.mode);
  const session = useOS((s) => s.session);
  const boot = useOS((s) => s.boot);
  useEffect(() => { setMounted(true); if (!bare(path) || path === '/login') void boot(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const needsLogin = mounted && mode === 'live' && !session && !bare(path);
  useEffect(() => { if (needsLogin) router.replace(`/login?next=${encodeURIComponent(path ?? '/')}`); }, [needsLogin, path, router]);
  if (mounted && bare(path)) {
    return (<><ThemeSync /><div className="ambient pointer-events-none fixed inset-0 -z-10" />{children}<Toaster /></>);
  }
  if (!mounted || mode === 'connecting' || needsLogin) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-[248px] border-r hairline lg:block" />
        <div className="flex-1 space-y-4 p-8"><Skeleton className="h-10 w-80" /><div className="grid grid-cols-4 gap-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-96" /></div>
      </div>
    );
  }
  return (
    <div className="relative flex min-h-screen">
      <ThemeSync />
      <div className="ambient pointer-events-none fixed inset-0 -z-10" />
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <MobileNav />
        <AnimatePresence mode="wait">
          <motion.main key={path} id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-8 md:py-8"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}>
            <ModuleGuard>{children}</ModuleGuard>
          </motion.main>
        </AnimatePresence>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t hairline px-6 py-4 text-2xs text-ink-3">
          <span>Sampledge AI Research OS · {mode === 'live' ? 'records served by the API; seeded records are fictional demo data' : 'offline demo, all records are fictional'}</span>
          <span className="flex items-center gap-2"><Badge tone="neutral">v0.10.0</Badge> No external integrations connected</span>
        </footer>
      </div>
      <CommandPalette />
      <LiveBridge />
      <Assistant />
      <Toaster />
    </div>
  );
}
