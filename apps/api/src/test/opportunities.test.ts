/**
 * Creating an opportunity: it is owned by the person who creates it unless an owner is named, it
 * must belong to one of the workspace's clients, and the creation is audited.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

const body = { title: 'Owner default test', audience: 'B2B', countries: ['DE'], sampleSize: 500, incidence: 0.25, loi: 15 };

describe('opportunity create', () => {
  let clientId = '';
  before(async () => {
    const tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
    clientId = (await h.db.client.findFirstOrThrow({ where: { tenantId } })).id;
  });

  it('is owned by the signed-in user by default', async () => {
    const r = await as('bizdev').post('/opportunities', { ...body, clientId });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const me = (await as('bizdev').get('/auth/me')).body;
    assert.equal(r.body.owner, me.user?.name ?? me.name);
    assert.equal(r.body.stage, 'New RFQ');
    assert.equal(await h.db.auditLog.count({ where: { action: 'opportunity.create', entityId: r.body.id } }), 1);
  });

  it('keeps a named owner, and refuses unknown or other-workspace clients', async () => {
    const r = await as('bizdev').post('/opportunities', { ...body, clientId, owner: 'Named Owner' });
    assert.equal(r.body.owner, 'Named Owner');
    assert.equal((await as('bizdev').post('/opportunities', { ...body, clientId: 'cl-nope' })).status, 404);
    assert.equal((await as('iso').post('/opportunities', { ...body, clientId })).status, 404);
  });
});
