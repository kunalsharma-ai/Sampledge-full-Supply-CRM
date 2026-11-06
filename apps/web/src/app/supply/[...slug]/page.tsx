'use client';
/**
 * Placeholder for SUPPLY360 screens that land in a later delivery wave. It shows the screen's
 * design brief and points to the existing module that covers the job today, so navigation never
 * dead-ends. Built screens have their own route folders, which take precedence over this one.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Compass } from 'lucide-react';
import { Badge, Panel, Skeleton, buttonVariants } from '@/components/ui/primitives';
import { SupplyHeader } from '@/components/supply/kit';
import { supplyIcon } from '@/components/shell/supply-icons';
import { brandColors, screenBySlug, screenHref, screens } from '@/lib/supply/screens';
import { moduleById } from '@/lib/modules';
import type { ModuleId } from '@/lib/core';

const waveName: Record<number, string> = {
  2: 'Respondents & audiences', 3: 'Fieldwork', 4: 'Engagement', 5: 'Rewards, support & quality', 6: 'Global, connected products & platform',
};

export default function ScreenBrief() {
  const params = useParams<{ slug: string[] }>();
  const slug = (params.slug ?? []).join('/');
  const sc = screenBySlug(slug);
  if (!sc) {
    return (
      <Panel className="mx-auto mt-16 max-w-lg text-center">
        <OrbitMark />
        <h1 className="mt-3 font-display text-lg font-semibold">This screen does not exist</h1>
        <p className="mt-1 text-sm text-ink-3">Check the address, or jump to a screen with <kbd className="rounded border hairline px-1">/</kbd>.</p>
        <Link href="/supply/executive" className={buttonVariants({ variant: 'primary', size: 'sm', className: 'mt-4' })}>Go to the Executive Dashboard</Link>
      </Panel>
    );
  }
  const Icon = supplyIcon(sc.icon);
  const brand = sc.brand && brandColors[sc.brand];
  const today: ModuleId | null = ({ panels: 'panels', automation: 'automation', communications: 'communications', marketplace: 'marketplace', integrations: 'integrations', admin: 'admin', analytics: 'analytics', 'command-center': 'command-center' } as Record<string, ModuleId>)[sc.module] ?? null;
  const mod = today ? moduleById(today) : null;
  const siblings = screens.filter((x) => x.group === sc.group && x.slug !== sc.slug && !x.hidden);
  return (
    <div className="space-y-5">
      <SupplyHeader screen={sc} source="live" title={<span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary" style={brand ? { color: brand.color, background: `color-mix(in srgb, ${brand.color} 14%, transparent)` } : undefined}><Icon size={20} /></span>{sc.label}</span>}
        subtitle={sc.summary} actions={<Badge tone="purple">Wave {sc.wave} · {waveName[sc.wave]}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-7">
          <div className="eyebrow mb-2">Design brief</div>
          <p className="text-[14px] leading-relaxed text-ink">{sc.layout}</p>
          <p className="mt-3 text-[13px] text-ink-3">This screen is designed in the Audience Orbit X specification and is scheduled for wave {sc.wave}. The layout below is its wireframe.</p>
          <div className="mt-5 grid grid-cols-12 gap-2" aria-hidden>
            <Skeleton className="col-span-12 h-10" />
            <Skeleton className="col-span-4 h-40" /><Skeleton className="col-span-8 h-40" />
            <Skeleton className="col-span-8 h-28" /><Skeleton className="col-span-4 h-28" />
          </div>
        </Panel>
        <div className="space-y-4 lg:col-span-5">
          {mod && (
            <Panel>
              <div className="eyebrow mb-2">Available today</div>
              <p className="text-[13px] text-ink-2">The existing <b className="text-ink">{mod.label}</b> module covers part of this job until the new screen ships.</p>
              <Link href={mod.href} className={buttonVariants({ size: 'sm', className: 'mt-3' })}>Open {mod.label} <ArrowRight size={13} /></Link>
            </Panel>
          )}
          <Panel>
            <div className="eyebrow mb-2">More in {sc.group}</div>
            <ul className="space-y-1">
              {siblings.map((x) => {
                const I = supplyIcon(x.icon);
                return <li key={x.slug}><Link href={screenHref(x)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2/50"><I size={14} className="text-ink-3" /> <span className="flex-1">{x.label}</span><span className="text-2xs text-ink-3">wave {x.wave}</span></Link></li>;
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Empty-state illustration: three orbits and a probe, drawn in theme tokens. */
function OrbitMark({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" className="mx-auto" aria-hidden>
      <circle cx="36" cy="36" r="30" fill="none" stroke="rgb(var(--ink-3) / .3)" strokeDasharray="3 5" />
      <circle cx="36" cy="36" r="20" fill="none" stroke="rgb(var(--primary) / .5)" />
      <circle cx="36" cy="36" r="9" fill="rgb(var(--primary) / .15)" stroke="rgb(var(--primary))" />
      <circle cx="56" cy="22" r="3.5" fill="rgb(var(--cyan))" />
      <Compass x="29" y="29" width="14" height="14" className="text-primary" />
    </svg>
  );
}
