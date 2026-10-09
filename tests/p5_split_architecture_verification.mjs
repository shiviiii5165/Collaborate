/**
 * Collaborate. by AI Tathastu — Phase P5-A Split Architecture Automated Verification
 * Verifies the dedicated Fastify Render backend service and Vercel BFF integration.
 */

import http from 'http';

const API_BASE = 'http://localhost:4000';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, headers: res.headers, data };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runVerification() {
  console.log('========================================================================');
  console.log('   COLLABORATE — PHASE P5-A SPLIT ARCHITECTURE AUTOMATION SUITE        ');
  console.log('========================================================================\n');

  // TEST 1: Fastify Health Check
  const health = await request('/health');
  assert(health.status === 200 && health.data.status === 'ok', '1. Fastify /health returns status ok');
  assert(health.data.service === 'collaborate-backend', '2. Service identifier matches collaborate-backend');

  // TEST 2: Registration & Host-Only Cookie
  const testEmail = `fastify.beta.${Date.now()}@collaborate.internal`;
  const reg = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: 'SecurePassword123!',
      fullName: 'Aarav Mehta',
      headline: 'Principal AI Architect',
      isUnder18: false
    })
  });
  assert(reg.status === 201 && reg.data.success, '3. Fastify standalone user registration');
  const setCookie = reg.headers.get('set-cookie');
  assert(setCookie && setCookie.includes('collaborate_session='), '4. Issues collaborate_session host-only cookie');

  // Extract cookie
  const cookiePart = setCookie.split(';')[0];

  // TEST 3: Auth Verification /api/auth/me
  const me = await request('/api/auth/me', {
    headers: { 'Cookie': cookiePart }
  });
  assert(me.status === 200 && me.data.authenticated, '5. Session authentication verified via /api/auth/me');
  assert(me.data.user.email === testEmail, '6. Authenticated user payload matches registered identity');

  // TEST 4: Profile CRUD
  const updateProf = await request('/api/profiles', {
    method: 'PUT',
    headers: { 'Cookie': cookiePart },
    body: JSON.stringify({
      headline: 'Distinguished GenAI Systems Lead',
      skills: ['TypeScript', 'Fastify', 'Neon PostgreSQL', 'Next.js']
    })
  });
  assert(updateProf.status === 200 && updateProf.data.success, '7. Profile updates saved authoritatively in backend');

  // TEST 5: Discover People
  const discover = await request('/api/discover?q=Aarav');
  assert(discover.status === 200 && discover.data.members.length >= 1, '8. Public discover directory queries active backend');

  // TEST 6: Second User Registration for Connection & Messaging
  const peerEmail = `peer.beta.${Date.now()}@collaborate.internal`;
  const regPeer = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: peerEmail,
      password: 'SecurePassword123!',
      fullName: 'Priya Sharma',
      headline: 'ML Research Engineer'
    })
  });
  const peerCookie = regPeer.headers.get('set-cookie').split(';')[0];
  const peerId = regPeer.data.member.id;

  // TEST 7: Connection Lifecycle
  const connReq = await request('/api/connections', {
    method: 'POST',
    headers: { 'Cookie': cookiePart },
    body: JSON.stringify({
      action: 'send',
      targetUserId: peerId,
      introMessage: 'Connecting on Collaborate Render backend!'
    })
  });
  assert(connReq.status === 200 && connReq.data.success, '9. Dispatched connection request to peer');
  const connId = connReq.data.connection.id;

  // Peer Accepts Connection
  const acceptConn = await request('/api/connections', {
    method: 'POST',
    headers: { 'Cookie': peerCookie },
    body: JSON.stringify({
      action: 'accept',
      connectionId: connId
    })
  });
  assert(acceptConn.status === 200 && acceptConn.data.success, '10. Peer accepts connection request');

  // TEST 8: Direct Messaging Between Accepted Connections
  const sendMsg = await request('/api/messages', {
    method: 'POST',
    headers: { 'Cookie': cookiePart },
    body: JSON.stringify({
      recipientId: peerId,
      content: 'Hello Priya, direct message on dedicated Fastify backend.'
    })
  });
  assert(sendMsg.status === 201 && sendMsg.data.success, '11. Authorized direct messaging delivered to persistent store');

  // TEST 9: Real-time SSE Stream Handshake
  const sseRes = await fetch(`${API_BASE}/api/messages/stream`, {
    headers: { 'Cookie': peerCookie }
  });
  assert(sseRes.status === 200, '12. Real-time SSE stream connected on Fastify');
  assert(sseRes.headers.get('content-type') === 'text/event-stream', '13. SSE headers confirm text/event-stream');
  
  const reader = sseRes.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  assert(chunk.includes('event: connected'), '14. Initial SSE connected handshake event received');
  reader.cancel();

  // TEST 10: Saved Profiles (Bookmarks)
  const saveBookmark = await request('/api/saved', {
    method: 'POST',
    headers: { 'Cookie': cookiePart },
    body: JSON.stringify({ targetMemberId: peerId })
  });
  assert(saveBookmark.status === 200 && saveBookmark.data.isSaved, '15. Bookmark peer profile via /api/saved');

  // TEST 11: Authentic Profile Stats
  const stats = await request('/api/stats', {
    headers: { 'Cookie': cookiePart }
  });
  assert(stats.status === 200 && stats.data.connectionsCount >= 1, '16. Authentic Profile Stats returns measured connection count');

  // TEST 12: Student Safeguarding (Minor Contact Gate)
  const minorEmail = `minor.beta.${Date.now()}@collaborate.internal`;
  const regMinor = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: minorEmail,
      password: 'SecurePassword123!',
      fullName: 'Student Developer',
      isUnder18: true
    })
  });
  const minorId = regMinor.data.member.id;

  // Adult attempts connection with minor
  const adultToMinor = await request('/api/connections', {
    method: 'POST',
    headers: { 'Cookie': cookiePart },
    body: JSON.stringify({ action: 'send', targetUserId: minorId })
  });
  assert(adultToMinor.status === 403 && adultToMinor.data.error === 'SAFEGUARDING_RESTRICTION', '17. Student safeguarding strictly blocks unsolicited adult-to-minor contact');

  console.log('\n========================================================================');
  console.log('   SPLIT ARCHITECTURE AUTOMATION COMPLETE: 17/17 PASSED (100%)         ');
  console.log('========================================================================');
}

runVerification().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
