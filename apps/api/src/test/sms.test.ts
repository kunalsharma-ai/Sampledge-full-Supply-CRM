/**
 * SMS delivery for the Comms Hub, against a local stand-in for a Twilio-compatible REST API.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { as, h, setup, teardown } from './harness';

type Sms = { path: string; auth: string; to: string; from: string; body: string };
const outbox: Sms[] = [];
const REFUSED = '+12025550199';
const api = createServer((req, res) => {
  let raw = '';
  req.on('data', (c: Buffer) => (raw += c.toString()));
  req.on('end', () => {
    const f = new URLSearchParams(raw);
    const to = f.get('To') ?? '';
    if (to === REFUSED) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ code: 21211, message: `The 'To' number ${to} is not a valid phone number.` }));
    }
    outbox.push({ path: req.url ?? '', auth: req.headers.authorization ?? '', to, from: f.get('From') ?? '', body: f.get('Body') ?? '' });
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sid: `SM${outbox.length}`, status: 'queued' }));
  });
});

before(async () => {
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  delete process.env.SMTP_HOST; delete process.env.SMTP_FROM;
  Object.assign(process.env, {
    SMS_API_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    SMS_ACCOUNT_SID: 'AC_test_account', SMS_AUTH_TOKEN: 'sms-secret-token', SMS_FROM: '+12025550100',
  });
  await setup();
});
after(async () => {
  for (const k of ['SMS_API_URL', 'SMS_ACCOUNT_SID', 'SMS_AUTH_TOKEN', 'SMS_FROM']) delete process.env[k];
  await teardown();
  await new Promise<void>((r) => api.close(() => r()));
});

const send = async (b: Record<string, string>) => {
  const r = await as('platform_admin').post('/comms/messages', { channel: 'sms', subject: 'Reminder', body: 'Fieldwork closes Friday.', ...b });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.drain();
  return h.db.message.findUniqueOrThrow({ where: { id: r.body.message.id } });
};
const memberId = async (email: string) => (await h.db.user.findUniqueOrThrow({ where: { email } })).id;

describe('SMS delivery', () => {
  it('reports the SMS provider without credentials', async () => {
    const r = await as('platform_admin').get('/comms/adapter');
    assert.deepEqual(r.body.channels, { email: 'off', sms: 'api' });
    assert.match(r.body.name, /SMS via SMS API \(127\.0\.0\.1:\d+\)/);
    assert.ok(!JSON.stringify(r.body).includes('sms-secret-token'));
    const integ = (await as('platform_admin').get('/integrations')).body.find((x: { id: string }) => x.id === 'messaging');
    assert.equal(integ.state, 'configured');
    assert.ok(integ.settings.some((x: { name: string; set: boolean }) => x.name === 'SMS_AUTH_TOKEN' && x.set));
    assert.ok(!JSON.stringify(integ).includes('sms-secret-token'));
  });

  it('texts the phone number on file for a vendor’s account', async () => {
    const before = outbox.length;
    const m = await send({ audience: 'vendor', target: 'vendor:vd-01' });
    assert.equal(m.status, 'sent', m.error ?? '');
    assert.ok(m.deliveredAt);
    const sms = outbox.slice(before);
    assert.equal(sms.length, 1);
    assert.equal(sms[0].to, '+12025550102');
    assert.equal(sms[0].from, '+12025550100');
    assert.equal(sms[0].body, 'Fieldwork closes Friday.');
    assert.equal(sms[0].path, '/2010-04-01/Accounts/AC_test_account/Messages.json');
    assert.equal(sms[0].auth, `Basic ${Buffer.from('AC_test_account:sms-secret-token').toString('base64')}`);
    const integ = (await as('platform_admin').get('/integrations')).body.find((x: { id: string }) => x.id === 'messaging');
    assert.equal(integ.state, 'connected');
  });

  it('says why when nobody has a number, and does not send e-mail without SMTP', async () => {
    const before = outbox.length;
    const m = await send({ audience: 'internal', target: 'role:bizdev' });
    assert.equal(m.status, 'not_sent');
    assert.match(m.error ?? '', /phone number on file/);
    const mail = await as('platform_admin').post('/comms/messages', { channel: 'email', audience: 'internal', target: 'role:finance', subject: 'x', body: 'y' });
    await h.drain();
    const e = await h.db.message.findUniqueOrThrow({ where: { id: mail.body.message.id } });
    assert.equal(e.status, 'not_sent');
    assert.match(e.error ?? '', /No e-mail provider/);
    assert.equal(outbox.length, before);
  });

  it('records a refused number as failed and never retries it', async () => {
    const bizdev = await memberId('bizdev@demo.sampledge.test');
    assert.equal((await as('platform_admin').patch(`/admin/users/${bizdev}/phone`, { phone: REFUSED })).status, 200);
    const before = outbox.length;
    const m = await send({ audience: 'internal', target: 'role:bizdev' });
    assert.equal(m.status, 'failed');
    assert.match(m.error ?? '', /21211/);
    const { deliveryAdapter } = await import('../modules/delivery');
    await deliveryAdapter.deliver(h.db, m.id);
    assert.equal((await h.db.message.findUniqueOrThrow({ where: { id: m.id } })).status, 'failed');
    assert.equal(outbox.length, before);
    await as('platform_admin').patch(`/admin/users/${bizdev}/phone`, { phone: null });
  });

  it('refuses an SMS longer than 1,600 characters', async () => {
    const r = await as('platform_admin').post('/comms/messages', { channel: 'sms', audience: 'vendor', target: 'vendor:vd-01', subject: 'x', body: 'a'.repeat(1601) });
    assert.equal(r.status, 400);
  });
});

describe('admin: phone numbers', () => {
  it('normalises, validates, audits only the last digits, and stays in this workspace', async () => {
    const pm2 = await memberId('project.manager2@demo.sampledge.test');
    const r = await as('platform_admin').patch(`/admin/users/${pm2}/phone`, { phone: '+44 (20) 7946-0000' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.phone, '+442079460000');
    const list = (await as('platform_admin').get('/admin/users')).body;
    assert.equal(list.find((u: { id: string }) => u.id === pm2).phone, '+442079460000');
    const audit = (await as('platform_admin').get('/audit?action=phone.changed')).body[0];
    assert.equal(audit.after.phone, '…0000');
    assert.ok(!JSON.stringify(audit).includes('7946'));
    assert.equal((await as('platform_admin').patch(`/admin/users/${pm2}/phone`, { phone: '07946 0000' })).status, 400, 'international form only');
    assert.equal((await as('executive').patch(`/admin/users/${pm2}/phone`, { phone: '+442079460001' })).status, 403);
    const iso = await memberId('admin@isolation.sampledge.test');
    assert.equal((await as('platform_admin').patch(`/admin/users/${iso}/phone`, { phone: '+442079460001' })).status, 404);
    assert.equal((await as('platform_admin').patch(`/admin/users/${pm2}/phone`, { phone: '' })).body.phone, null);
  });
});
