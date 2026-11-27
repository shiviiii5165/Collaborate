/**
 * Direct messaging end to end, through the real HTTP routes (in-process Fastify inject, isolated fixtures).
 *
 * Regression for: a new connection never appeared in Messages (a conversation only existed after a first
 * message), so nobody could send the first message; unread counts never cleared; no anti-spam limit.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/messaging_flow.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const { buildServer } = await import('../apps/api/src/server.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { messagesSentPerMember } = await import('../src/lib/http/rate-limit.ts');

const app = buildServer();
const runId = `${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
async function makeUser(label) {
  const { member, token } = await IdentityService.registerStandalone(`${label}_${runId}@fixtures.collaborate.test`, `Fixture-${label}-Pass1!`, `Fixture ${label}`);
  return { id: member.id, auth: { authorization: `Bearer ${token}` } };
}
const inject = (opts) => app.inject(opts);
const json = (res) => JSON.parse(res.body || '{}');

let passed = 0;
let total = 0;
async function test(title, fn) {
  total++;
  process.stdout.write(`  [TEST ${total}] ${title}... `);
  try {
    await fn();
    passed++;
    console.log('PASSED');
  } catch (err) {
    console.log('FAILED');
    console.error(err);
    process.exitCode = 1;
  }
}

const a = await makeUser('msg_a');
const b = await makeUser('msg_b');
const stranger = await makeUser('msg_s');

console.log('\n=== Messaging flow ===\n');

await test('Connecting through the API makes each side appear in the other\'s chat list, ready to message', async () => {
  const req = await inject({ method: 'POST', url: '/api/connections', headers: a.auth, payload: { action: 'send', targetUserId: b.id } });
  assert.strictEqual(req.statusCode, 201, req.body);
  const acc = await inject({ method: 'POST', url: '/api/connections', headers: b.auth, payload: { action: 'accept', connectionId: json(req).connection.id } });
  assert.strictEqual(acc.statusCode, 200, acc.body);

  for (const [me, other] of [[a, b], [b, a]]) {
    const list = json(await inject({ method: 'GET', url: '/api/messages', headers: me.auth })).conversations;
    const entry = list.find((c) => c.participantIds.includes(other.id));
    assert.ok(entry, 'new connection is listed');
    assert.strictEqual(entry.isNew, true);
    assert.strictEqual(entry.canMessage, true);
    assert.ok(!('email' in entry.otherMember), 'no private fields');
  }
});

await test('The first message sends, and the chat becomes a real conversation with one unread for the recipient', async () => {
  const sent = await inject({ method: 'POST', url: '/api/messages', headers: a.auth, payload: { recipientId: b.id, content: `hello ${runId}` } });
  assert.strictEqual(sent.statusCode, 201, sent.body);
  const list = json(await inject({ method: 'GET', url: '/api/messages', headers: b.auth })).conversations;
  const conv = list.filter((c) => c.participantIds.includes(a.id));
  assert.strictEqual(conv.length, 1, 'no duplicate chat entry');
  assert.strictEqual(conv[0].isNew, false);
  assert.strictEqual(conv[0].unreadCount, 1);
  assert.strictEqual(conv[0].lastMessage.content, `hello ${runId}`);
  const thread = json(await inject({ method: 'GET', url: `/api/messages?conversationId=${conv[0].id}`, headers: b.auth })).messages;
  assert.strictEqual(thread.length, 1);
});

await test('Replying works, and marking read clears the unread count (only for a participant)', async () => {
  const conv = json(await inject({ method: 'GET', url: '/api/messages', headers: b.auth })).conversations.find((c) => c.participantIds.includes(a.id));
  const reply = await inject({ method: 'POST', url: '/api/messages', headers: b.auth, payload: { recipientId: a.id, content: 'hi back' } });
  assert.strictEqual(reply.statusCode, 201, reply.body);

  const foreign = await inject({ method: 'POST', url: '/api/messages/read', headers: stranger.auth, payload: { conversationId: conv.id } });
  assert.strictEqual(foreign.statusCode, 404);
  const read = await inject({ method: 'POST', url: '/api/messages/read', headers: b.auth, payload: { conversationId: conv.id } });
  assert.strictEqual(read.statusCode, 200);
  const after = json(await inject({ method: 'GET', url: '/api/messages', headers: b.auth })).conversations.find((c) => c.id === conv.id);
  assert.strictEqual(after.unreadCount, 0);
});

await test('A non-connection cannot message, cannot message themselves, and is not listed', async () => {
  const res = await inject({ method: 'POST', url: '/api/messages', headers: stranger.auth, payload: { recipientId: a.id, content: 'spam' } });
  assert.strictEqual(res.statusCode, 403);
  const self = await inject({ method: 'POST', url: '/api/messages', headers: a.auth, payload: { recipientId: a.id, content: 'me' } });
  assert.strictEqual(self.statusCode, 400);
  const list = json(await inject({ method: 'GET', url: '/api/messages', headers: stranger.auth })).conversations;
  assert.strictEqual(list.length, 0);
});

await test('Sending is rate limited per member', async () => {
  messagesSentPerMember.reset(a.id);
  let limited = false;
  for (let i = 0; i < 70 && !limited; i++) {
    const r = await inject({ method: 'POST', url: '/api/messages', headers: a.auth, payload: { recipientId: b.id, content: `burst ${i}` } });
    if (r.statusCode === 429) limited = true;
  }
  assert.ok(limited, 'burst is throttled');
  messagesSentPerMember.reset(a.id);
});

await test('Blocking hides the chat for both sides and stops messages', async () => {
  const blk = await inject({ method: 'POST', url: '/api/connections', headers: b.auth, payload: { action: 'block', targetMemberId: a.id } });
  assert.strictEqual(blk.statusCode, 200);
  for (const me of [a, b]) {
    const list = json(await inject({ method: 'GET', url: '/api/messages', headers: me.auth })).conversations;
    assert.ok(!list.some((c) => c.participantIds.includes(me === a ? b.id : a.id)));
  }
  const res = await inject({ method: 'POST', url: '/api/messages', headers: a.auth, payload: { recipientId: b.id, content: 'after block' } });
  assert.strictEqual(res.statusCode, 403);
});

console.log(`\n${passed}/${total} passed\n`);
await app.close();
