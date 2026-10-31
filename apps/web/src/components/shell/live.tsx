'use client';
/**
 * Keeps the signed-in workspace current: listens to the API's live channel (Server-Sent Events) and
 * refreshes records when something changes elsewhere, with a toast for notifications meant for this
 * role. The browser reconnects by itself if the stream drops.
 */
import { useEffect } from 'react';
import { useOS } from '@/lib/store';

export function LiveBridge() {
  const sessionId = useOS((s) => (s.mode === 'live' && s.session ? s.session.user.id + s.role : null));
  useEffect(() => {
    if (!sessionId || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/v1/live');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void useOS.getState().refresh(), 600); };
    es.addEventListener('change', refresh);
    es.addEventListener('notification', (m) => {
      try { const d = JSON.parse((m as MessageEvent).data) as { title?: string }; if (d.title) useOS.getState().toast(d.title); } catch { /* ignore */ }
      refresh();
    });
    return () => { clearTimeout(timer); es.close(); };
  }, [sessionId]);
  return null;
}
