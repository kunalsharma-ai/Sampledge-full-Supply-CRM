'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell, Bot, Building2, ChartScatter, Check, ChevronRight, ChevronsLeft, Command, Database, Globe2, KanbanSquare, Keyboard, Landmark, Lock, Menu as Menu_, MessagesSquare,
  KeyRound, LogOut, Monitor, Orbit, Palette, Plug, RotateCcw, ShieldCheck, Sparkles, Target, Truck, Users, Workflow, Zap, ZapOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isBuilt, modules } from '@/lib/modules';
import { access, roles } from '@/lib/core';
import { demoLoginsEnabled } from '@/lib/api';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Badge, Button, DemoBadge, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogTrigger, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, SheetContent, TooltipProvider } from '@/components/ui/overlay';
import { resolveTheme, themeById, themes } from '@/lib/themes';
import { screenByPath, screenHref, screens } from '@/lib/supply/screens';
import { Assistant } from './assistant';
import { SupplyNav } from './supply-nav';
import { supplyIcon } from './supply-icons';
import { CommandPalette } from './command-palette';
import { Logo } from './logo';
import { LiveBridge } from './live';

export const icons: Record<string, LucideIcon> = {
  Orbit, KanbanSquare, Bot, MessagesSquare, Workflow, Users, Database, ChartScatter, Sparkles, Target, Globe2, Landmark, Building2, Truck, Plug, ShieldCheck, Palette,
};

function ThemeSync() {
  const theme = useOS((s) => s.theme);
  const motionPref = useOS((s) => s.motion);
  const density = useOS((s) => s.density);
  const textSize = useOS((s) => s.textSize);
  // Layout effect: tokens must be on <html> before charts (passive effects) read them.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const id = resolveTheme(theme, mq.matches);
      root.dataset.theme = id;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeById(id).swatch[0]);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = motionPref;
    root.dataset.density = density;
    root.dataset.text = textSize;
  }, [motionPref, density, textSize]);
  return null;
}

function Sidebar({ filterRef }: { filterRef: React.RefObject<HTMLInputElement | null> }) {
  const collapsed = useOS((s) => s.sidebarCollapsed);
  const setCollapsed = useOS((s) => s.setSidebarCollapsed);
  return (
    <aside className={cn('sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r hairline bg-bg/70 backdrop-blur-xl transition-[width] duration-200 lg:flex', collapsed ? 'w-[64px]' : 'w-[264px]')}>
      <div className={cn('flex h-14 items-center gap-2', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Logo compact={collapsed} />
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto pb-3 pt-1', collapsed ? 'px-1.5' : 'px-2')}>
        <SupplyNav collapsed={collapsed} filterRef={filterRef} />
      </div>
      <div className="border-t hairline p-2">
        <Button variant="ghost" size="sm" className={cn('w-full', collapsed ? 'justify-center px-0' : 'justify-start')} onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar ( [ )">
          <ChevronsLeft size={15} className={cn('transition-transform', collapsed && 'rotate-180')} />
          {!collapsed && <><span className="flex-1 text-left">Collapse</span><Kbd>[</Kbd></>}
        </Button>
      </div>
    </aside>
  );
}

function ThemeMenu() {
  const theme = useOS((s) => s.theme);
  const setTheme = useOS((s) => s.setTheme);
  const router = useRouter();
  const current = theme === 'system' ? null : themeById(theme);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${current?.name ?? 'Follow system'}`} title="Theme">
          <span className="grid h-4 w-4 overflow-hidden rounded-full ring-1 ring-ink-3/40" style={{ background: current ? `conic-gradient(${current.swatch[3]} 0 50%, ${current.swatch[0]} 0)` : 'conic-gradient(#0C142E 0 50%, #F4F6FC 0)' }} />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Theme</MenuLabel>
        {themes.map((t) => (
          <MenuItem key={t.id} onSelect={() => setTheme(t.id)}>
            <span className="h-3.5 w-3.5 rounded-full ring-1 ring-ink-3/30" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[3]} 50%)` }} />
            {t.name}{theme === t.id && <Check size={13} className="ml-auto text-primary" />}
          </MenuItem>
        ))}
        <MenuItem onSelect={() => setTheme('system')}><Monitor size={13} /> Follow system{theme === 'system' && <Check size={13} className="ml-auto text-primary" />}</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => router.push('/supply/theme-studio')}><Palette size={13} /> Theme Studio…</MenuItem>
      </MenuContent>
    </Menu>
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

function Topbar({ setShortcuts }: { setShortcuts: (v: boolean) => void }) {
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
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b hairline bg-bg/60 px-3 backdrop-blur-xl md:gap-3 md:px-6">
      <MobileMenu />
      <div className="lg:hidden"><Logo compact /></div>
      <Crumb />
      <button onClick={() => setPalette(true)} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border hairline bg-surface-2/40 px-3 text-left text-[13px] text-ink-3 transition-colors hover:border-primary/40 md:ml-4 md:min-w-[200px] md:max-w-md">
        <Command size={14} className="shrink-0" /> <span className="flex-1 truncate"><span className="md:hidden">Search…</span><span className="hidden md:inline">Search screens, panellists, requests, actions…</span></span>
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
        <ThemeMenu />
        <Button variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Keyboard shortcuts" title="Keyboard shortcuts ( ? )" onClick={() => setShortcuts(true)}><Keyboard size={15} /></Button>
        <Notifications />
        <Button variant="subtle" size="sm" onClick={() => setAssistant(true)} className="hidden sm:inline-flex"><Sparkles size={14} /> Ask Sampledge AI</Button>
        <label className="flex items-center gap-2 rounded-xl border hairline bg-surface-2/40 py-1 pl-1 pr-2" title={session ? `${session.user.name} · ${session.user.email}` : 'Viewing as role (offline demo)'}>
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-primary-strong to-primary-2 text-2xs font-bold text-on-primary">{who.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
          <span className="sr-only">{mode === 'live' ? 'Signed in as role' : 'Viewing as role'}</span>
          {mode === 'live' && !demoLoginsEnabled
            ? <span className="max-w-[150px] truncate text-xs font-medium">{persona.label}</span>
            : <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="max-w-[92px] bg-transparent md:max-w-[150px] text-xs font-medium text-ink outline-none" aria-label={mode === 'live' ? 'Switch demo account' : 'Switch role'}>
                {roles.map((r) => <option key={r.id} value={r.id} className="bg-bg-2">{r.label}</option>)}
              </select>}
        </label>
        {mode === 'live' && <Link href="/account" title="Your account and two-step sign-in" aria-label="Your account" className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2/60 hover:text-ink"><KeyRound size={15} /></Link>}
        {mode === 'live' && <Button variant="ghost" size="icon" title="Sign out" aria-label="Sign out" onClick={async () => { await signOut(); router.replace('/login'); }}><LogOut size={15} /></Button>}
      </div>
    </header>
  );
}

/** Current location, shown beside the search on desktop. */
function Crumb() {
  const path = usePathname();
  const sc = screenByPath(path);
  const mod = sc ? null : modules.find((m) => path?.startsWith(m.href));
  if (!sc && !mod) return null;
  return (
    <div className="hidden min-w-0 items-center gap-1.5 text-[13px] xl:flex">
      <span className="text-ink-3">{sc ? sc.group : 'Research OS'}</span>
      <ChevronRight size={12} className="text-ink-3" />
      <span className="truncate font-medium text-ink">{sc ? sc.label : mod!.label}</span>
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu_ size={18} /></Button>
      </DialogTrigger>
      <SheetContent title="Navigation">
        <div className="flex h-14 items-center gap-2 border-b hairline px-4"><Logo /></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2"><SupplyNav onNavigate={() => setOpen(false)} /></div>
      </SheetContent>
    </Dialog>
  );
}

/** Phone and tablet: the five jobs a supply executive does most, one tap away. */
const mobileTabs = [
  { slug: 'executive', label: 'Home', icon: 'Gauge' },
  { slug: 'panellists', label: 'Panellists', icon: 'Users' },
  { slug: 'segmentation', label: 'Audiences', icon: 'Boxes' },
  { slug: 'quotas', label: 'Quotas', icon: 'Target' },
  { slug: 'rewards', label: 'Rewards', icon: 'Wallet' },
];
function MobileTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t hairline bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      {mobileTabs.map((t) => {
        const Icon = supplyIcon(t.icon);
        const on = path?.startsWith(`/supply/${t.slug}`);
        return (
          <Link key={t.slug} href={`/supply/${t.slug}`} aria-current={on ? 'page' : undefined} className={cn('flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium', on ? 'text-primary' : 'text-ink-3')}>
            <Icon size={18} /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

const shortcutList: [string, string][] = [
  ['⌘ K', 'Search everything'], ['/', 'Jump to a screen'], ['[', 'Collapse or expand sidebar'], ['?', 'Show this list'],
  ...screens.filter((s) => s.key).map((s) => [`g ${s.key}`, s.label] as [string, string]),
  ['↑ ↓ or j k', 'Move between table rows'], ['Enter', 'Open the focused row'], ['x', 'Select the focused row'], ['Esc', 'Close or clear selection'],
];
function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="Shortcuts work anywhere except while typing in a field.">
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {shortcutList.map(([k, l]) => (
            <li key={k} className="flex items-center justify-between gap-3 text-[13px]"><span className="text-ink-2">{l}</span><span className="flex gap-1">{k.split(' ').map((p, i) => <Kbd key={i}>{p}</Kbd>)}</span></li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Global shortcuts: g-then-key navigation, [ sidebar, ? help, / jump. Ignored while typing. */
function useShortcuts(filterRef: React.RefObject<HTMLInputElement | null>, setShortcuts: (v: boolean) => void) {
  const router = useRouter();
  useEffect(() => {
    let g = 0;
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (Date.now() - g < 1200) {
        const sc = screens.find((s) => s.key === e.key.toLowerCase());
        g = 0;
        if (sc) { e.preventDefault(); router.push(screenHref(sc)); }
        return;
      }
      if (e.key === 'g') { g = Date.now(); return; }
      if (e.key === '[') { const st = useOS.getState(); st.setSidebarCollapsed(!st.sidebarCollapsed); }
      else if (e.key === '?') { e.preventDefault(); setShortcuts(true); }
      else if (e.key === '/') {
        e.preventDefault();
        if (filterRef.current && filterRef.current.offsetParent) filterRef.current.focus();
        else useOS.getState().setPalette(true);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [router, filterRef, setShortcuts]);
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
  const sc = useMemo(() => screenByPath(path), [path]);
  const mod = useMemo(() => (sc ? { id: sc.module, label: sc.label } : modules.find((m) => path?.startsWith(m.href))), [path, sc]);
  if (mod && access(role, mod.id) === 'none') {
    const firstScreen = screens.find((x) => !x.hidden && access(role, x.module) !== 'none');
    const first = firstScreen ? { href: screenHref(firstScreen), label: firstScreen.label } : modules.find((m) => access(role, m.id) !== 'none' && isBuilt(m));
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
  const [shortcuts, setShortcuts] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  useShortcuts(filterRef, setShortcuts);
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
        <div className="hidden w-[264px] border-r hairline lg:block" />
        <div className="flex-1 space-y-4 p-8"><Skeleton className="h-10 w-80" /><div className="grid grid-cols-4 gap-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-96" /></div>
      </div>
    );
  }
  return (
    <TooltipProvider>
    <div className="relative flex min-h-screen">
      <ThemeSync />
      <div className="ambient pointer-events-none fixed inset-0 -z-10" />
      <Sidebar filterRef={filterRef} />
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        <Topbar setShortcuts={setShortcuts} />
        <AnimatePresence mode="wait">
          <motion.main key={path} id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-8 md:py-8"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
            <ModuleGuard>{children}</ModuleGuard>
          </motion.main>
        </AnimatePresence>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t hairline px-6 py-4 text-2xs text-ink-3">
          <span>SUPPLY360 · Audience Orbit X · {mode === 'live' ? 'records served by the API; seeded and synthetic records are demo data' : 'offline demo, all records are fictional'}</span>
          <span className="flex items-center gap-2"><Badge tone="neutral">v0.12.0</Badge> Press <Kbd>?</Kbd> for shortcuts</span>
        </footer>
      </div>
      <CommandPalette />
      <LiveBridge />
      <Assistant />
      <Toaster />
      <MobileTabs />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </div>
    </TooltipProvider>
  );
}
