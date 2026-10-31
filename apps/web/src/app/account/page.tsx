'use client';
/**
 * Your account: who you are signed in as, and two-step sign-in (TOTP) for this person.
 * The QR code is drawn in the browser from the enrolment reply; the secret is never stored here.
 * Once two-step sign-in is on, changing device or turning it off needs a current code.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { api, type Session } from '@/lib/api';
import { useOS } from '@/lib/store';
import { Badge, Button, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';

type Enrolment = { secret: string; otpauthUrl: string };
const codeOk = (c: string) => /^\d{6}$/.test(c);

export default function AccountPage() {
  const session = useOS((s) => s.session);
  const mode = useOS((s) => s.mode);
  const toast = useOS((s) => s.toast);
  const [mfaOn, setMfaOn] = useState(false);
  const [step, setStep] = useState<'idle' | 'confirm-current' | 'scan' | 'disable'>('idle');
  const [enrol, setEnrol] = useState<Enrolment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (session) setMfaOn(session.user.mfaEnabled); }, [session]);
  useEffect(() => {
    if (!enrol) { setQr(null); return; }
    QRCode.toDataURL(enrol.otpauthUrl, { margin: 1, width: 192 }).then(setQr).catch(() => setQr(null));
  }, [enrol]);

  if (mode !== 'live' || !session) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Account" title="Your account" />
        <Panel><EmptyState icon={<KeyRound size={18} />} title="Sign in to the live workspace" body="Account settings are kept on the API server, so they are not available in the offline demo." /></Panel>
      </div>
    );
  }

  const reset = () => { setStep('idle'); setEnrol(null); setCode(''); setCurrent(''); setErr(null); };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };
  const start = (withCode?: string) => run(async () => {
    setEnrol(await api<Enrolment>('/auth/mfa/enroll', { method: 'POST', body: withCode ? { code: withCode } : {} }));
    setStep('scan'); setCode('');
  });
  const activate = () => run(async () => {
    await api('/auth/mfa/activate', { method: 'POST', body: { code } });
    const wasOn = mfaOn;
    setMfaOn(true); reset();
    useOS.setState({ session: { ...session, user: { ...session.user, mfaEnabled: true } } as Session });
    toast(wasOn ? 'Two-step sign-in moved to the new device' : 'Two-step sign-in is on');
  });
  const disable = () => run(async () => {
    await api('/auth/mfa/disable', { method: 'POST', body: { code: current } });
    setMfaOn(false); reset();
    useOS.setState({ session: { ...session, user: { ...session.user, mfaEnabled: false } } as Session });
    toast('Two-step sign-in is off', 'warn');
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Your account" subtitle={`Signed in to ${session.tenant.name} as ${session.user.email}.`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Panel>
          <PanelHeader eyebrow="Profile" title={session.user.name} />
          <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
            <dt className="text-ink-3">E-mail</dt><dd>{session.user.email}</dd>
            <dt className="text-ink-3">Workspace</dt><dd>{session.tenant.name}</dd>
            <dt className="text-ink-3">Role</dt><dd className="capitalize">{session.role.replace(/_/g, ' ')}</dd>
          </dl>
          <p className="mt-4 text-2xs text-ink-3">Your name, e-mail and role are managed by a platform admin under Admin &amp; Security.</p>
        </Panel>

        <Panel>
          <PanelHeader eyebrow="Security" title="Two-step sign-in"
            actions={mfaOn ? <Badge tone="emerald" dot>On</Badge> : <Badge tone="orange" dot>Off</Badge>}
            info="After your password, sign-in asks for a six-digit code from an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password). Sign-in through your company's single sign-on uses that provider's own checks instead." />

          {step === 'idle' && (
            <div className="space-y-3">
              <p className="text-[13px] text-ink-2">{mfaOn
                ? 'Sign-in with your password also asks for a code from your authenticator app.'
                : 'Add a code from an authenticator app to every password sign-in. This protects your account if your password is ever exposed.'}</p>
              <div className="flex flex-wrap gap-2">
                {mfaOn ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => { setStep('confirm-current'); setErr(null); }}><Smartphone size={14} /> Move to a new device</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setStep('disable'); setErr(null); }}><ShieldOff size={14} /> Turn off</Button>
                  </>
                ) : (
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => start()}><ShieldCheck size={14} /> {busy ? 'Starting…' : 'Turn on two-step sign-in'}</Button>
                )}
              </div>
            </div>
          )}

          {(step === 'confirm-current' || step === 'disable') && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (codeOk(current)) void (step === 'disable' ? disable() : start(current)); }}>
              <p className="text-[13px] text-ink-2">{step === 'disable' ? 'Enter a current code from your authenticator app to turn two-step sign-in off.' : 'Enter a current code from your existing authenticator app. Your old device keeps working until the new one is confirmed.'}</p>
              <Field label="Current code"><input className={`${inputCls} max-w-[180px] tracking-[.3em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))} autoFocus aria-label="Current code" /></Field>
              <div className="flex gap-2">
                <Button type="submit" variant={step === 'disable' ? 'danger' : 'primary'} size="sm" disabled={busy || !codeOk(current)}>{busy ? 'Checking…' : step === 'disable' ? 'Turn off' : 'Continue'}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
              </div>
            </form>
          )}

          {step === 'scan' && enrol && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (codeOk(code)) void activate(); }}>
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
                <li>Open your authenticator app and add an account.</li>
                <li>Scan this code, or type the key below.</li>
                <li>Enter the six-digit code the app shows.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-4">
                <div className="grid h-[200px] w-[200px] place-items-center rounded-xl bg-white p-1">
                  {qr ? <img src={qr} alt="QR code for your authenticator app" width={192} height={192} /> : <span className="text-2xs text-neutral-500">Drawing code…</span>}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-2xs font-semibold uppercase tracking-wider text-ink-3">Key</div>
                  <code className="block break-all rounded-lg bg-surface-2/60 px-2 py-1 font-mono text-[12px]">{enrol.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                  <div className="text-2xs text-ink-3">Time-based, six digits, 30 seconds</div>
                </div>
              </div>
              <Field label="Code from the app"><input className={`${inputCls} max-w-[180px] tracking-[.3em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus aria-label="Code from the app" /></Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={busy || !codeOk(code)}>{busy ? 'Checking…' : 'Confirm and turn on'}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
              </div>
            </form>
          )}

          {err && <p role="alert" className="mt-3 text-[13px] text-danger">{err}</p>}
        </Panel>
      </div>
    </div>
  );
}
