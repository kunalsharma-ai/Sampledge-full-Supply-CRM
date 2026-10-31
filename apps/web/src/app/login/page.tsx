'use client';
import { ArrowRight, KeyRound, Loader2, ServerOff, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { roles, type Role } from '@/lib/core';
import { ApiError, demoEmail, demoLoginsEnabled, DEMO_PASSWORD } from '@/lib/api';
import { useOS } from '@/lib/store';
import { Badge, Button, Field, inputCls } from '@/components/ui/primitives';
import { Logo } from '@/components/shell/logo';
import { cn } from '@/lib/utils';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/command-center';
  const [sso, setSso] = useState<{ enabled: boolean; label: string | null } | null>(null);
  useEffect(() => { fetch('/api/v1/auth/sso/config').then((r) => (r.ok ? r.json() : null)).then(setSso).catch(() => setSso(null)); }, []);
  const mode = useOS((s) => s.mode);
  const session = useOS((s) => s.session);
  const signIn = useOS((s) => s.signIn);
  const verifyMfa = useOS((s) => s.verifyMfa);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get('sso_error'));

  useEffect(() => { if (session) router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/command-center'); }, [session, next, router]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'The API is not reachable. Start it with npm run dev.'); } finally { setBusy(null); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('form', async () => {
      if (challenge) { await verifyMfa(challenge, code); return; }
      const r = await signIn(email, password);
      if (r.mfaRequired) setChallenge(r.challenge!);
    });
  };
  const quick = (role: Role) => run(role, async () => { const r = await signIn(demoEmail(role), DEMO_PASSWORD); if (r.mfaRequired) { setEmail(demoEmail(role)); setChallenge(r.challenge!); } });

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-5xl items-center gap-10 px-4 py-10 md:grid-cols-[1fr_1.1fr] md:px-8">
      <div>
        <Logo />
        <h1 className="mt-8 font-display text-3xl font-semibold leading-tight md:text-4xl">Your research operation,<br /><span className="text-gradient">one command center.</span></h1>
        <p className="mt-4 max-w-sm text-sm text-ink-2">Sign in to the Sampledge workspace. Every record you see is scoped to your role and organisation by the server, not just hidden in the interface.</p>
        <ul className="mt-6 space-y-2 text-[13px] text-ink-2">
          <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald" /> Session cookie is httpOnly; optional TOTP two-factor</li>
          <li className="flex items-center gap-2"><KeyRound size={14} className="text-cyan" /> Binding quotes, sample purchases and publishing wait for a human</li>
        </ul>
        {mode === 'offline' && (
          <div className="panel-solid mt-6 flex items-start gap-3 p-3 text-[12.5px]">
            <ServerOff size={16} className="mt-0.5 shrink-0 text-warn" />
            <div><div className="font-medium">API not reachable</div><div className="text-ink-3">Start it with <code className="text-ink-2">npm run dev</code>, or continue with the offline demo (records stay in this browser).</div>
              <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => router.push('/command-center')}>Continue offline <ArrowRight size={13} /></Button></div>
          </div>
        )}
      </div>

      <div className="panel p-6 md:p-8">
        <div className="flex items-center justify-between"><h2 className="font-display text-lg font-semibold">{challenge ? 'Two-factor code' : 'Sign in'}</h2><Badge tone="neutral">Phase 6</Badge></div>
        <form onSubmit={submit} className="mt-5 space-y-3">
          {!challenge ? (
            <>
              <Field label="Work email"><input className={inputCls} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Password"><input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            </>
          ) : (
            <Field label="6-digit code from your authenticator app" hint={email}><input className={cn(inputCls, 'num tracking-[0.3em]')} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
          )}
          {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={!!busy}>{busy === 'form' ? <Loader2 size={14} className="animate-spin" /> : null}{challenge ? 'Verify' : 'Sign in'}</Button>
          {challenge && <button type="button" className="w-full text-center text-2xs text-ink-3 hover:text-ink" onClick={() => { setChallenge(null); setCode(''); }}>Use a different account</button>}
          {sso?.enabled && !challenge && <a href={`/api/v1/auth/sso/start?next=${encodeURIComponent(next)}`} className="flex h-9 w-full items-center justify-center rounded-xl border hairline text-[13px] font-medium hover:bg-surface-2/60">{sso.label}</a>}
        </form>

        {demoLoginsEnabled && !challenge && (
          <div className="mt-7 border-t hairline pt-5">
            <div className="eyebrow">Demo accounts</div>
            <p className="mt-1 text-2xs text-ink-3">Fictional users seeded by <code>npm run db:seed</code>, password <code>{DEMO_PASSWORD}</code>. Disable with NEXT_PUBLIC_DEMO_LOGINS=false.</p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {roles.map((r) => (
                <button key={r.id} type="button" disabled={!!busy || mode === 'offline'} onClick={() => quick(r.id)}
                  className="group flex items-center gap-2 rounded-xl border hairline px-2.5 py-2 text-left transition-colors hover:border-blue/50 disabled:opacity-40">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue/80 to-purple/80 text-2xs font-bold text-white">{busy === r.id ? <Loader2 size={12} className="animate-spin" /> : r.persona.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                  <span className="min-w-0"><span className="block truncate text-[12px] font-medium">{r.label}</span><span className="block truncate text-2xs text-ink-3">{r.persona.replace(' (Demo)', '')}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
