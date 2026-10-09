const renderUrl = 'https://collaborate-sggk.onrender.com';
const vercelUrl = 'https://collaborate-umber.vercel.app';

async function probe() {
  console.log('========================================================================');
  console.log('PROBING LIVE CLOUD DEPLOYMENTS: VERCEL & RENDER');
  console.log('========================================================================\n');

  console.log('1. Probing Render API endpoints (' + renderUrl + ')...');
  try {
    const res = await fetch(`${renderUrl}/health`);
    console.log(`   GET /health: Status ${res.status}`);
    const text = await res.text();
    console.log(`   Headers:`, Object.fromEntries(res.headers.entries()));
    console.log(`   Body preview:`, text.slice(0, 150));
  } catch (e) {
    console.log(`   GET /health error:`, e.message);
  }

  console.log('\n2. Probing Render /api/health...');
  try {
    const res = await fetch(`${renderUrl}/api/health`);
    console.log(`   GET /api/health: Status ${res.status}`);
    const text = await res.text();
    console.log(`   Body preview:`, text.slice(0, 150));
  } catch (e) {
    console.log(`   GET /api/health error:`, e.message);
  }

  console.log('\n3. Probing Vercel frontend root (' + vercelUrl + ')...');
  try {
    const res = await fetch(`${vercelUrl}/`);
    console.log(`   GET /: Status ${res.status}`);
    console.log(`   Server header:`, res.headers.get('server'));
    console.log(`   x-vercel-id:`, res.headers.get('x-vercel-id'));
  } catch (e) {
    console.log(`   GET / error:`, e.message);
  }

  console.log('\n4. Probing Vercel /api/auth/me...');
  try {
    const res = await fetch(`${vercelUrl}/api/auth/me`);
    console.log(`   GET /api/auth/me: Status ${res.status}`);
    const text = await res.text();
    console.log(`   Body preview:`, text.slice(0, 150));
  } catch (e) {
    console.log(`   GET /api/auth/me error:`, e.message);
  }

  console.log('\n5. Probing Vercel /api/health proxy...');
  try {
    const res = await fetch(`${vercelUrl}/api/health`);
    console.log(`   GET /api/health: Status ${res.status}`);
    const text = await res.text();
    console.log(`   Body preview:`, text.slice(0, 150));
  } catch (e) {
    console.log(`   GET /api/health error:`, e.message);
  }
}

probe();
