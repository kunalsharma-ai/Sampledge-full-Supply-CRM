/**
 * SMTP delivery for the Comms Hub, against a real SMTP server on localhost.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { as, h, setup, teardown } from './harness';

type Mail = { from: string; to: string[]; data: string };
const inbox: Mail[] = [];
const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  onRcptTo(addr, _s, cb) {
    cb(addr.address.startsWith('bizdev@') ? Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 }) : undefined);
  },
  onData(stream, session, cb) {
    let data = '';
    stream.on('data', (c: Buffer) => (data += c.toString()));
    stream.on('end', () => {
      inbox.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((r) => r.address), data });
      cb();
    });
  },
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String((server.server.address() as AddressInfo).port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'Sampledge <noreply@sampledge.test>';
  await setup();
});
after(async () => {
  await teardown();
  await new Promise<void>((r) => server.close(() => r()));
});

const send = async (b: Record<string, string>) => {
  const r = await as('platform_admin').post('/comms/messages', { channel: 'email', subject: 'Status update', body: 'Fieldwork closes Friday.', ...b });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.drain();
  return h.db.message.findUniqueOrThrow({ where: { id: r.body.message.id } });
};

describe('SMTP delivery', () => {
  it('reports the active adapter without credentials', async () => {
    const r = await as('platform_admin').get('/comms/adapter');
    assert.equal(r.body.mode, 'smtp');
    assert.match(r.body.name, /^SMTP \(127\.0\.0\.1:\d+\)$/);
  });

  it('e-mails the people behind a role, each as a blind copy', async () => {
    const before = inbox.length;
    const m = await send({ audience: 'internal', target: 'role:finance' });
    assert.equal(m.status, 'sent', m.error ?? '');
    assert.ok(m.deliveredAt);
    const mail = inbox.slice(before);
    assert.equal(mail.length, 1);
    assert.deepEqual(mail[0].to, ['finance@demo.sampledge.test']);
    assert.match(mail[0].data, /Subject: Status update/);
    assert.match(mail[0].data, /Fieldwork closes Friday\./);
    assert.ok(!/^Bcc:/im.test(mail[0].data), 'blind copies are not listed in the headers');
  });

  it('e-mails a vendor’s account', async () => {
    const before = inbox.length;
    const m = await send({ audience: 'vendor', target: 'vendor:vd-01' });
    assert.equal(m.status, 'sent', m.error ?? '');
    assert.ok(inbox.slice(before)[0].to.includes('vendor@demo.sampledge.test'));
  });

  it('does not send SMS or panel e-mail, and says why', async () => {
    const before = inbox.length;
    const sms = await send({ channel: 'sms', audience: 'internal', target: 'role:finance' });
    assert.equal(sms.status, 'not_sent');
    assert.match(sms.error ?? '', /Only e-mail/);
    const t = (await h.db.tenant.findFirstOrThrow({ where: { slug: 'sampledge-demo' } })).id;
    const panel = await h.db.message.create({ data: { tenantId: t, channel: 'email', audience: 'panel', toRef: 'panel:turn2opinion:all', recipients: 5, subject: 'x', body: 'y', status: 'queued', createdBy: 'test' } });
    const { deliveryAdapter } = await import('../modules/delivery');
    await deliveryAdapter.deliver(h.db, panel.id);
    const p = await h.db.message.findUniqueOrThrow({ where: { id: panel.id } });
    assert.equal(p.status, 'not_sent');
    assert.match(p.error ?? '', /panel’s own site/);
    assert.equal(inbox.length, before, 'nothing reached the SMTP server');
  });

  it('records a rejected send as failed and never retries it', async () => {
    const before = inbox.length;
    const m = await send({ audience: 'internal', target: 'role:bizdev' });
    assert.equal(m.status, 'failed');
    assert.match(m.error ?? '', /550|unavailable/i);
    const { deliveryAdapter } = await import('../modules/delivery');
    await deliveryAdapter.deliver(h.db, m.id);
    assert.equal((await h.db.message.findUniqueOrThrow({ where: { id: m.id } })).status, 'failed');
    assert.equal(inbox.length, before);
  });
});
