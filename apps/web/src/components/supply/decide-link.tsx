import { ExternalLink } from 'lucide-react';

/** Live, decisions on audience requests belong to a SampAudience approver: this opens the SampAudience console. */
export function DecideInSampAudience({ url, label = 'Decide in SampAudience' }: { url: string | null; label?: string }) {
  if (!url) return <span className="text-2xs text-ink-3">Decisions are made in the SampAudience console.</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20">
      <ExternalLink size={13} aria-hidden /> {label}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
