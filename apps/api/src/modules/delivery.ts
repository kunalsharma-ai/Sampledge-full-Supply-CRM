/**
 * Outbound message delivery for the Comms Hub.
 *
 * With no provider configured, every message is recorded by the development adapter and nothing
 * leaves the system (status `delivered_dev`). Each channel has its own opt-in provider:
 * - e-mail: SMTP, when SMTP_HOST and SMTP_FROM are set;
 * - SMS: a Twilio-compatible REST API, when SMS_ACCOUNT_SID, SMS_AUTH_TOKEN and SMS_FROM are set.
 * Messages reach people who have a Sampledge account (client and vendor contacts, internal roles):
 * their e-mail address, or the phone number an administrator recorded on their membership.
 * Panel members are pseudonymous here, so their contact details live only in the panel's own site:
 * panel messages, in-app messages and channels without a provider stay `not_sent` with the reason,
 * rather than being faked.
 *
 * A message is sent at most once: the worker only delivers messages still `queued`, and a send that
 * fails is recorded as `failed` with the error instead of being retried.
 */
import { Prisma } from '@prisma/client';
import nodemailer, { type Transporter } from 'nodemailer';
import type { PrismaService } from '../common/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; password?: string; from: string };

/** SMTP settings from the environment, or null when e-mail sending is off. Read on each call so tests and operators can change them. */
export function smtpConfig(env = process.env): SmtpConfig | null {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  return { host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465, user: env.SMTP_USER || undefined, password: env.SMTP_PASSWORD || undefined, from: env.SMTP_FROM };
}

export type SmsConfig = { apiUrl: string; accountSid: string; authToken: string; from: string };

/** SMS settings from the environment, or null when SMS sending is off. SMS_API_URL points elsewhere for a compatible provider or a test stand-in. */
export function smsConfig(env = process.env): SmsConfig | null {
  if (!env.SMS_ACCOUNT_SID || !env.SMS_AUTH_TOKEN || !env.SMS_FROM) return null;
  return { apiUrl: (env.SMS_API_URL || 'https://api.twilio.com').replace(/\/+$/, ''), accountSid: env.SMS_ACCOUNT_SID, authToken: env.SMS_AUTH_TOKEN, from: env.SMS_FROM };
}

/** Longest SMS body accepted (the provider splits it into segments; 1,600 characters is Twilio's limit). */
export const SMS_MAX = 1600;

const DEV = 'development (recorded, not sent)';
const smtpName = (c: SmtpConfig) => `SMTP (${c.host}:${c.port})`;
const smsName = (c: SmsConfig) => `SMS API (${new URL(c.apiUrl).host})`;

/** Sends one SMS. Throws with the provider's message when it refuses. */
async function sendSms(c: SmsConfig, to: string, body: string, ref: string) {
  const r = await fetch(`${c.apiUrl}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', 'x-sampledge-message': ref },
    body: new URLSearchParams({ To: to, From: c.from, Body: body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { message?: string; code?: number } | null;
    throw new Error(`SMS provider refused (${r.status}${j?.code ? `, code ${j.code}` : ''}): ${j?.message ?? r.statusText}`);
  }
}
let transport: { key: string; t: Transporter } | null = null;
function transporter(c: SmtpConfig) {
  const key = JSON.stringify(c);
  if (transport?.key !== key) {
    transport = {
      key,
      t: nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.password ?? '' } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }),
    };
  }
  return transport.t;
}

/** The Sampledge accounts a message target reaches, with their e-mail and phone. Panel targets have none here. */
export async function recipientContacts(tx: Tx, tenantId: string, toRef: string): Promise<{ email: string; phone: string | null }[] | null> {
  const [kind, a] = toRef.split(':');
  const where =
    kind === 'client' ? { tenantId, clientId: a } :
    kind === 'vendor' ? { tenantId, vendorId: a } :
    kind === 'role' ? { tenantId, role: a as never } :
    kind === 'users' ? { tenantId, userId: { in: (a ?? '').split(',').filter(Boolean).slice(0, 50) } } : null;
  if (!where) return null;
  const ms = await tx.membership.findMany({ where, include: { user: { select: { email: true } } } });
  return ms.map((m) => ({ email: m.user.email, phone: m.phone }));
}

/** E-mail addresses a message target reaches. */
export async function recipientAddresses(tx: Tx, tenantId: string, toRef: string): Promise<string[] | null> {
  const c = await recipientContacts(tx, tenantId, toRef);
  return c && [...new Set(c.map((x) => x.email))];
}

const PANEL = 'Panel members are reached through the panel’s own site; their contact details are not stored here.';

export const deliveryAdapter = {
  /** Shown in the Comms Hub and on the Integrations page. Never includes credentials. */
  get name() {
    const e = smtpConfig(), t = smsConfig();
    if (!e && !t) return DEV;
    return [e ? `e-mail via ${smtpName(e)}` : 'e-mail not configured', t ? `SMS via ${smsName(t)}` : 'SMS not configured'].join('; ');
  },
  /** E-mail mode (kept for callers that predate SMS). */
  get mode(): 'development' | 'smtp' {
    return smtpConfig() ? 'smtp' : 'development';
  },
  /** Provider state for each channel. 'off' means another channel has a provider but this one does not. */
  get channels(): { email: 'development' | 'smtp' | 'off'; sms: 'development' | 'api' | 'off' } {
    const e = smtpConfig(), t = smsConfig();
    if (!e && !t) return { email: 'development', sms: 'development' };
    return { email: e ? 'smtp' : 'off', sms: t ? 'api' : 'off' };
  },
  async deliver(tx: Tx, messageId: string) {
    const m = await tx.message.findUnique({ where: { id: messageId } });
    if (!m || m.status !== 'queued') return;
    const e = smtpConfig(), t = smsConfig();
    if (!e && !t) {
      await tx.message.update({ where: { id: m.id }, data: { status: 'delivered_dev', adapter: DEV, deliveredAt: new Date() } });
      return;
    }
    const notSent = (adapter: string, error: string) => tx.message.update({ where: { id: m.id }, data: { status: 'not_sent', adapter, error } });
    if (m.channel === 'in_app') return void (await notSent(DEV, 'In-app messages are kept in the delivery log only; there is no in-app inbox yet.'));
    if (m.channel === 'email' && !e) return void (await notSent(DEV, 'No e-mail provider is configured (set SMTP_HOST and SMTP_FROM).'));
    if (m.channel === 'sms' && !t) return void (await notSent(DEV, 'No SMS provider is configured (set SMS_ACCOUNT_SID, SMS_AUTH_TOKEN and SMS_FROM).'));
    const adapter = m.channel === 'email' ? smtpName(e!) : smsName(t!);
    const people = await recipientContacts(tx, m.tenantId, m.toRef);
    if (people === null) return void (await notSent(adapter, PANEL));

    if (m.channel === 'email') {
      const to = [...new Set(people.map((p) => p.email))];
      if (!to.length) return void (await notSent(adapter, 'No Sampledge account is linked to this recipient, so there is no address to send to.'));
      try {
        // Each address gets its own copy (bcc), so recipients never see one another.
        const info = await transporter(e!).sendMail({ from: e!.from, bcc: to, subject: m.subject, text: m.body, headers: { 'X-Sampledge-Message': m.id } });
        const rejected = ((info.rejected ?? []) as (string | { address: string })[]).map((r) => (typeof r === 'string' ? r : r.address));
        await tx.message.update({ where: { id: m.id }, data: { status: 'sent', adapter, deliveredAt: new Date(), error: rejected.length ? `Refused by the mail server for ${rejected.length} of ${to.length} address(es)` : null } });
      } catch (err) {
        await tx.message.update({ where: { id: m.id }, data: { status: 'failed', adapter, error: String((err as Error).message ?? err).slice(0, 500) } });
      }
      return;
    }

    // SMS: one request per number, so one refused number does not stop the rest.
    const phones = [...new Set(people.map((p) => p.phone).filter((p): p is string => !!p))];
    const missing = people.length - people.filter((p) => p.phone).length;
    if (!phones.length) return void (await notSent(adapter, 'Nobody behind this recipient has a phone number on file. An administrator adds it in Admin & Security → People and roles.'));
    const errors: string[] = [];
    for (const to of phones) {
      try { await sendSms(t!, to, m.body, m.id); } catch (err) { errors.push(String((err as Error).message ?? err)); }
    }
    const notes = [errors.length ? `Refused for ${errors.length} of ${phones.length} number(s): ${errors[0]}` : '', missing ? `${missing} person(s) have no phone number on file` : ''].filter(Boolean).join('. ');
    if (errors.length === phones.length) {
      await tx.message.update({ where: { id: m.id }, data: { status: 'failed', adapter, error: notes.slice(0, 500) } });
    } else {
      await tx.message.update({ where: { id: m.id }, data: { status: 'sent', adapter, deliveredAt: new Date(), error: notes ? notes.slice(0, 500) : null } });
    }
  },
};
