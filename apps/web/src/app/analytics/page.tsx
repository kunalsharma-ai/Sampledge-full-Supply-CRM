'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SurveyResults } from '@/components/analytics/results';
import { MethodsLab } from '@/components/analytics/methods';
import { PageHeader, Segmented } from '@/components/ui/primitives';

type View = 'results' | 'methods';
function InsightStudio() {
  const sp = useSearchParams();
  const router = useRouter();
  const view = (['results', 'methods'].includes(sp?.get('view') ?? '') ? sp!.get('view') : 'results') as View;
  const switcher = (
    <Segmented className="mb-5" label="Insight Studio view" value={view} onChange={(v) => router.replace(`/analytics?view=${v}`)}
      options={[{ value: 'results', label: 'Survey results' }, { value: 'methods', label: 'Advanced methods' }]} />
  );
  return (
    <div>
      <PageHeader eyebrow="Insight Studio" title={view === 'results' ? 'Survey results' : 'Advanced methods'}
        subtitle={view === 'results' ? 'Frequencies, banners with significance letters and a PowerPoint report, computed from recorded responses.' : 'Design generators and analyses for MaxDiff, choice-based conjoint, Van Westendorp, Gabor-Granger and TURF.'} />
      {switcher}
      {view === 'results' ? <SurveyResults /> : <MethodsLab />}
    </div>
  );
}

export default function AnalyticsPage() { return <Suspense><InsightStudio /></Suspense>; }
