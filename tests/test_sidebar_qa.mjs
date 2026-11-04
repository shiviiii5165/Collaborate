import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const WEB_PORT = 3077;
  const GATEWAY_URL = `http://127.0.0.1:${WEB_PORT}/test-sidebar`;
  const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\ec564d24-74e3-4616-bdf4-abec076bc223';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  console.log('--- 1. STARTING NEXT.JS APP FOR SIDEBAR QA ---');
  const nextServer = spawn('npx', ['next', 'start', '-p', String(WEB_PORT)], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      COLLABORATE_BACKEND_URL: 'https://collaborate-1-am72.onrender.com',
      PORT: String(WEB_PORT),
    },
    shell: true,
  });

  await new Promise((resolve) => {
    let started = false;
    nextServer.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Ready') || msg.includes(String(WEB_PORT)) || msg.includes('started')) {
        if (!started) {
          started = true;
          resolve();
        }
      }
    });
    setTimeout(() => {
      if (!started) resolve();
    }, 4500);
  });
  console.log('Next.js app ready on port', WEB_PORT);

  let chromeProcess = null;

  try {
    // 2. Launch Chrome with Remote Debugging
    const CDP_PORT = 9334;
    const userDataDir = path.join(__dirname, '..', `.chrome-qa-temp-${Date.now()}`);
    fs.mkdirSync(userDataDir, { recursive: true });

    chromeProcess = spawn(
      chromePath,
      [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--window-size=1440,900',
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    // Wait for CDP
    let versionData = null;
    for (let i = 0; i < 20; i++) {
      try {
        const vRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (vRes.ok) {
          versionData = await vRes.json();
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(versionData, 'Chrome CDP failed to start');

    // Get page target
    const pagesRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const pages = await pagesRes.json();
    const pageTarget = pages.find((p) => p.type === 'page') || pages[0];
    assert(pageTarget?.webSocketDebuggerUrl, 'No page WebSocket URL found');

    const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    const sendCDP = (method, params = {}) => {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id === id) {
              ws.removeEventListener('message', handler);
              if (data.error) reject(data.error);
              else resolve(data.result);
            }
          } catch {}
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    await sendCDP('Page.enable');
    await sendCDP('Runtime.enable');

    console.log('Navigating to /test-sidebar in Chrome...');
    await sendCDP('Page.navigate', { url: GATEWAY_URL });

    // Poll until .left-sidebar is rendered
    console.log('Waiting for sidebar DOM...');
    let sidebarReady = false;
    for (let i = 0; i < 40; i++) {
      const chk = await sendCDP('Runtime.evaluate', {
        expression: '!!document.querySelector(".left-sidebar")',
        returnByValue: true,
      });
      if (chk.result?.value) {
        sidebarReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(sidebarReady, 'Sidebar failed to render in /test-sidebar');

    // Extract complete sidebar data
    const evalRes = await sendCDP('Runtime.evaluate', {
      expression: `(() => {
        const sidebar = document.querySelector('.left-sidebar');
        const brandTitle = document.querySelector('.sidebar-brand-title')?.textContent?.trim();
        const brandSub = document.querySelector('.sidebar-brand-sub')?.textContent?.trim();
        
        const navBtns = Array.from(document.querySelectorAll('.sidebar-nav-list .sidebar-nav-btn'));
        const labels = navBtns.map(b => b.querySelector('.sidebar-nav-label')?.textContent?.trim() || '');
        const soonBadges = navBtns.filter(b => b.querySelector('.sidebar-soon-badge')).map(b => b.querySelector('.sidebar-nav-label')?.textContent?.trim());
        
        const ecoLinks = Array.from(document.querySelectorAll('.sidebar-eco-link')).map(a => a.textContent?.trim());
        const switchLabel = document.querySelector('.sidebar-switch-label')?.textContent?.trim();
        const settingsText = document.querySelector('.sidebar-bottom-section .sidebar-nav-btn .sidebar-nav-label')?.textContent?.trim();
        const collapseBtn = document.querySelector('.sidebar-toggle-btn');
        const collapseText = collapseBtn?.querySelector('.sidebar-toggle-text')?.textContent?.trim();
        
        const styles = window.getComputedStyle(sidebar);
        const bg = styles.backgroundImage || styles.background;
        const width = styles.width;
        
        return {
          brandTitle,
          brandSub,
          labels,
          soonBadges,
          ecoLinks,
          switchLabel,
          settingsText,
          hasCollapseBtn: !!collapseBtn,
          collapseText,
          bg,
          width
        };
      })()`,
      returnByValue: true,
    });

    const info = evalRes.result?.value;
    console.log('Sidebar Extraction Result:\n', JSON.stringify(info, null, 2));

    // Assertions
    assert.strictEqual(info.brandTitle, 'Collaborate.', 'Must have "Collaborate." title');
    assert.strictEqual(info.brandSub, 'by AI Tathastu', 'Must have "by AI Tathastu" subtext');

    const expectedOrder = [
      'Home',
      'My Profile',
      'Discover People',
      'Connections',
      'Messages',
      'Communities',
      'Project Teams',
      'Opportunities',
      'Events',
      'Mentors',
      'Saved',
      'Analytics',
    ];
    assert.deepStrictEqual(info.labels, expectedOrder, '12 navigation items must match exact sequence');
    console.log('✅ 1. ALL 12 NAVIGATION ITEMS CONFIRMED IN EXACT ORDER');

    const expectedSoon = ['Communities', 'Project Teams', 'Opportunities', 'Events', 'Mentors'];
    assert.deepStrictEqual(info.soonBadges, expectedSoon, 'Unfinished items must display subtle Soon badges');
    console.log('✅ 2. UNFINISHED ITEMS DISPLAY SUBTLE "SOON" BADGES');

    assert.strictEqual(info.switchLabel, 'Switch to', 'Must display "Switch to" section');
    assert(info.ecoLinks.some(l => l.includes('AI Tathastu')), 'Must contain AI Tathastu link');
    assert(info.ecoLinks.some(l => l.includes('Tathastu Connect')), 'Must contain Tathastu Connect link');
    console.log('✅ 3. ECOSYSTEM SWITCH LINKS VERIFIED');

    assert.strictEqual(info.settingsText, 'Settings', 'Must contain Settings in bottom section');
    assert(info.hasCollapseBtn, 'Must contain Collapse button');
    assert.strictEqual(info.collapseText, 'Collapse', 'Must have Collapse text in expanded mode');
    console.log('✅ 4. SETTINGS & COLLAPSE CONTROLS VERIFIED');

    // Capture EXPANDED Screenshot
    const expandedShot = await sendCDP('Page.captureScreenshot', { format: 'png' });
    const expandedPath = path.join(ARTIFACTS_DIR, 'sidebar_expanded.png');
    fs.writeFileSync(expandedPath, Buffer.from(expandedShot.data, 'base64'));
    console.log('📸 5. EXPANDED SCREENSHOT SAVED:', expandedPath);

    // Click Collapse Button
    console.log('Clicking collapse button...');
    await sendCDP('Runtime.evaluate', {
      expression: 'document.querySelector(".sidebar-toggle-btn").click()',
    });

    // Wait for transition
    await new Promise((r) => setTimeout(r, 600));

    // Verify Collapsed state
    const collapsedEval = await sendCDP('Runtime.evaluate', {
      expression: `(() => {
        const sidebar = document.querySelector('.left-sidebar');
        const styles = window.getComputedStyle(sidebar);
        return {
          isCollapsed: sidebar.classList.contains('collapsed'),
          width: styles.width
        };
      })()`,
      returnByValue: true,
    });
    console.log('Collapsed State:\n', JSON.stringify(collapsedEval.result?.value, null, 2));

    assert(collapsedEval.result?.value?.isCollapsed, 'Sidebar must have .collapsed class');
    const widthVal = parseInt(collapsedEval.result?.value?.width, 10);
    assert(widthVal >= 68 && widthVal <= 76, `Collapsed width should be ~72px, got ${widthVal}px`);
    console.log('✅ 6. COLLAPSED STATE VERIFIED (~72px width)');

    // Capture COLLAPSED Screenshot
    const collapsedShot = await sendCDP('Page.captureScreenshot', { format: 'png' });
    const collapsedPath = path.join(ARTIFACTS_DIR, 'sidebar_collapsed.png');
    fs.writeFileSync(collapsedPath, Buffer.from(collapsedShot.data, 'base64'));
    console.log('📸 7. COLLAPSED SCREENSHOT SAVED:', collapsedPath);

    console.log('========================================================================');
    console.log('   🎉 ALL 7 SIDEBAR SPECIFICATIONS VERIFIED & SCREENSHOTS CAPTURED!     ');
    console.log('========================================================================');
  } finally {
    if (chromeProcess) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(chromeProcess.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          chromeProcess.kill();
        }
      } catch (_) {}
    }
    if (nextServer.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(nextServer.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill(nextServer.pid);
        }
      } catch (_) {}
    }
  }
}

run().catch((e) => {
  console.error('QA TEST FAILED:', e);
  process.exit(1);
});
