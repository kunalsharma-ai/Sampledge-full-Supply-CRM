/**
 * Outbound message delivery for the Comms Hub.
 *
 * Without SMTP settings every message is recorded by the development adapter and nothing leaves the
 * system (status `delivered_dev`). With SMTP_HOST and SMTP_FROM set, e-mail messages to people who
 * have a Sampledge account (client and vendor contacts, internal roles) are sent over SMTP
 * (status `sent`). Panel members are pseudonymous here, so their addresses live only in the panel's
 * own site: panel e-mail and all SMS stay `not_sent` with the reason, rather than being faked.
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

const DEV = 'development (recorded, not sent)';
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

/** E-mail addresses a message target reaches: the Sampledge accounts behind it. Panel targets have none here. */
export async function recipientAddresses(tx: Tx, tenantId: string, toRef: string): Promise<string[] | null> {
  const [kind, a] = toRef.split(':');
  const where =
    kind === 'client' ? { tenantId, clientId: a } :
    kind === 'vendor' ? { tenantId, vendorId: a } :
    kind === 'role' ? { tenantId, role: a as never } : null;
  if (!where) return null;
  const ms = await tx.membership.findMany({ where, include: { user: { select: { email: true } } } });
  return [...new Set(ms.map((m) => m.user.email))];
}

export const deliveryAdapter = {
  /** Shown in the Comms Hub and on the Integrations page. */
  get name() {
    const c = smtpConfig();
    return c ? `SMTP (${c.host}:${c.port})` : DEV;
  },
  get mode(): 'development' | 'smtp' {
    return smtpConfig() ? 'smtp' : 'development';
  },
  async deliver(tx: Tx, messageId: string) {
    const m = await tx.message.findUnique({ where: { id: messageId } });
    if (!m || m.status !== 'queued') return;
    const c = smtpConfig();
    if (!c) {
      await tx.message.update({ where: { id: m.id }, data: { status: 'delivered_dev', adapter: DEV, deliveredAt: new Date() } });
      return;
    }
    const adapter = `SMTP (${c.host}:${c.port})`;
    const notSent = (error: string) => tx.message.update({ where: { id: m.id }, data: { status: 'not_sent', adapter, error } });
    if (m.channel !== 'email') return void (await notSent('Only e-mail has a provider. SMS and in-app messages are not sent.'));
    const to = await recipientAddresses(tx, m.tenantId, m.toRef);
    if (to === null) return void (await notSent('Panel members are reached through the panel’s own site; their addresses are not stored here.'));
    if (!to.length) return void (await notSent('No Sampledge account is linked to this recipient, so there is no address to send to.'));
    try {
      // Each address gets its own copy (bcc), so recipients never see one another.
      const info = await transporter(c).sendMail({ from: c.from, bcc: to, subject: m.subject, text: m.body, headers: { 'X-Sampledge-Message': m.id } });
      const rejected = ((info.rejected ?? []) as (string | { address: string })[]).map((r) => (typeof r === 'string' ? r : r.address));
      await tx.message.update({ where: { id: m.id }, data: { status: 'sent', adapter, deliveredAt: new Date(), error: rejected.length ? `Refused by the mail server for ${rejected.length} of ${to.length} address(es)` : null } });
    } catch (e) {
      await tx.message.update({ where: { id: m.id }, data: { status: 'failed', adapter, error: String((e as Error).message ?? e).slice(0, 500) } });
    }
  },
};
