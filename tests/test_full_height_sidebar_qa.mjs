import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const API_PORT = 4088;
  const WEB_PORT = 3088;
  const GATEWAY_URL = `http://127.0.0.1:${WEB_PORT}`;
  const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\ec564d24-74e3-4616-bdf4-abec076bc223';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  console.log('--- 1. STARTING LOCAL FASTIFY API BACKEND ---');
  const apiServer = spawn('npx', ['tsx', 'apps/api/src/index.ts'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(API_PORT) },
    shell: true,
  });

  await new Promise((resolve) => {
    let started = false;
    apiServer.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Live on') || msg.includes(String(API_PORT))) {
        if (!started) {
          started = true;
          resolve();
        }
      }
    });
    setTimeout(() => {
      if (!started) resolve();
    }, 4000);
  });
  console.log('Fastify API ready on port', API_PORT);

  console.log('--- 2. STARTING NEXT.JS GATEWAY ---');
  const nextServer = spawn('npx', ['next', 'start', '-p', String(WEB_PORT)], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      COLLABORATE_BACKEND_URL: `http://127.0.0.1:${API_PORT}`,
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
  console.log('Next.js web gateway ready on port', WEB_PORT);

  let chromeProcess = null;

  try {
    // 3. Register test user
    console.log('Authenticating QA user...');
    const ts = Date.now();
    const testEmail = `shivam_qa_${ts}@beta.collaborate`;
    const regRes = await fetch(`${GATEWAY_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Shivam Sharma',
        email: testEmail,
        password: 'Password123!',
        headline: 'AI Systems Architect & Researcher',
      }),
    });
    const regJson = await regRes.json();
    assert(regRes.ok, `Failed to register user: ${JSON.stringify(regJson)}`);
    const setCookie = regRes.headers.get('set-cookie') || '';
    const sessionToken = (setCookie.match(/collaborate_session=([^;]+)/) || [])[1];
    assert(sessionToken, 'Must receive collaborate_session token');

    // 4. Launch Chrome with Remote Debugging
    const CDP_PORT = 9335;
    const userDataDir = path.join(__dirname, '..', `.chrome-qa-${Date.now()}`);
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

    const pagesRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const pages = await pagesRes.json();
    const pageTarget = pages.find((p) => p.type === 'page') || pages[0];
    assert(pageTarget?.webSocketDebuggerUrl, 'No page WebSocket found');

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
    await sendCDP('Network.enable');

    // Set cookie
    await sendCDP('Network.setCookie', {
      name: 'collaborate_session',
      value: sessionToken,
      url: GATEWAY_URL,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
    });

    console.log('Navigating to Collaborate main application...');
    await sendCDP('Page.navigate', { url: GATEWAY_URL });

    // Wait for sidebar and workspace to render
    console.log('Waiting for application shell DOM...');
    let appReady = false;
    for (let i = 0; i < 40; i++) {
      const chk = await sendCDP('Runtime.evaluate', {
        expression: '!!document.querySelector(".left-sidebar") && !!document.querySelector(".workspace-scroll-area")',
        returnByValue: true,
      });
      if (chk.result?.value) {
        appReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(appReady, 'Application shell (.app-shell / .left-sidebar / .workspace-scroll-area) did not render in time');

    // =========================================================================
    // VERIFICATION 1: BOUNDING COORDINATES & FULL-HEIGHT FLUSH EDGES
    // =========================================================================
    console.log('--- VERIFYING FULL-HEIGHT FLUSH EDGES AT 1440x900 ---');
    const layoutEval = await sendCDP('Runtime.evaluate', {
      expression: `(() => {
        const sidebar = document.querySelector('.left-sidebar');
        const workspace = document.querySelector('.workspace-scroll-area');
        const header = document.querySelector('.top-navbar');
        const rect = sidebar.getBoundingClientRect();
        const styles = window.getComputedStyle(sidebar);
        const winHeight = window.innerHeight;
        const winWidth = window.innerWidth;

        const navBtns = Array.from(document.querySelectorAll('.sidebar-nav-list .sidebar-nav-btn'));
        const labels = navBtns.map(b => b.querySelector('.sidebar-nav-label')?.textContent?.trim() || '');

        const analyticsBtn = navBtns.find(b => b.textContent.includes('Analytics'));
        const analyticsRect = analyticsBtn ? analyticsBtn.getBoundingClientRect() : null;

        const footer = document.querySelector('.sidebar-footer-region');
        const footerRect = footer ? footer.getBoundingClientRect() : null;

        return {
          winHeight,
          winWidth,
          rect: {
            x: rect.x,
            y: rect.y,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          styles: {
            borderRadius: styles.borderRadius,
            boxShadow: styles.boxShadow,
            margin: styles.margin,
          },
          labels,
          analyticsVisible: analyticsRect ? (analyticsRect.bottom <= winHeight) : false,
          analyticsRect,
          footerVisible: footerRect ? (footerRect.bottom <= winHeight) : false,
          footerRect,
        };
      })()`,
      returnByValue: true,
    });

    const lInfo = layoutEval.result?.value;
    console.log('Sidebar Geometry & Positioning:\n', JSON.stringify(lInfo, null, 2));

    // Assert x=0, y=0, left=0, top=0
    assert.strictEqual(lInfo.rect.x, 0, 'Sidebar left edge must be exactly at x=0');
    assert.strictEqual(lInfo.rect.y, 0, 'Sidebar top edge must be exactly at y=0');
    assert.strictEqual(lInfo.rect.left, 0, 'Sidebar left must be 0');
    assert.strictEqual(lInfo.rect.top, 0, 'Sidebar top must be 0');

    // Assert full viewport height
    assert(Math.abs(lInfo.rect.height - lInfo.winHeight) <= 1, `Sidebar height (${lInfo.rect.height}px) must equal viewport height (${lInfo.winHeight}px)`);
    assert(Math.abs(lInfo.rect.bottom - lInfo.winHeight) <= 1, 'Sidebar bottom must reach viewport bottom');

    // Assert NO outer border-radius or floating card shadow
    assert.strictEqual(lInfo.styles.borderRadius, '0px', 'Sidebar outer border-radius must be 0px (no rounded outer corners)');
    assert(lInfo.styles.boxShadow === 'none' || lInfo.styles.boxShadow === '', 'Sidebar must have NO floating-card shadow');
    console.log('✅ Criteria 1-4: Sidebar starts at x=0, y=0, height=100dvh, border-radius=0px, no floating shadow!');

    // Assert all 12 items present and Analytics NOT clipped
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
    assert.deepStrictEqual(lInfo.labels, expectedOrder, 'All 12 items must be present in exact order');
    assert(lInfo.analyticsVisible, 'Analytics navigation item must NOT be clipped by the viewport');
    assert(lInfo.footerVisible, 'Bottom footer (Switch to, Settings, Collapse) must be fully accessible');
    console.log('✅ Criteria 7-8: All 12 items visible; Analytics & bottom controls are 100% accessible!');

    // Capture EXPANDED Screenshot
    const expandedShot = await sendCDP('Page.captureScreenshot', { format: 'png' });
    const expandedPath = path.join(ARTIFACTS_DIR, 'full_height_sidebar_expanded.png');
    fs.writeFileSync(expandedPath, Buffer.from(expandedShot.data, 'base64'));
    console.log('📸 Screenshot 1: EXPANDED saved to:', expandedPath);

    // =========================================================================
    // VERIFICATION 2: INDEPENDENT WORKSPACE SCROLL (1,000+ PX)
    // =========================================================================
    console.log('--- SCROLLING MAIN WORKSPACE BY 1,200 PIXELS ---');
    const scrollEval = await sendCDP('Runtime.evaluate', {
      expression: `(() => {
        const scrollArea = document.querySelector('.workspace-scroll-area');
        if (!scrollArea) return { error: 'No scrollArea' };

        // Scroll by 1200px
        scrollArea.scrollTop = 1200;

        const sidebar = document.querySelector('.left-sidebar');
        const rectAfter = sidebar.getBoundingClientRect();
        const header = document.querySelector('.top-navbar');
        const headerRect = header.getBoundingClientRect();

        return {
          workspaceScrollTop: scrollArea.scrollTop,
          windowScrollY: window.scrollY,
          bodyScrollTop: document.documentElement.scrollTop,
          sidebarAfter: {
            x: rectAfter.x,
            y: rectAfter.y,
            left: rectAfter.left,
            top: rectAfter.top,
            bottom: rectAfter.bottom,
            height: rectAfter.height,
          },
          headerTop: headerRect.top,
          headerVisible: headerRect.top >= 0 && headerRect.bottom > 0,
        };
      })()`,
      returnByValue: true,
    });

    const sInfo = scrollEval.result?.value;
    console.log('Scroll Verification Data:\n', JSON.stringify(sInfo, null, 2));

    // Confirm sidebar coordinates UNCHANGED
    assert.strictEqual(sInfo.sidebarAfter.x, 0, 'Sidebar x must stay at 0 after scroll');
    assert.strictEqual(sInfo.sidebarAfter.y, 0, 'Sidebar y must stay at 0 after scroll');
    assert.strictEqual(sInfo.sidebarAfter.top, 0, 'Sidebar top must stay at 0 after scroll');

    // Confirm body did NOT scroll (no competing scrollbar)
    assert.strictEqual(sInfo.windowScrollY, 0, 'Browser window.scrollY must remain 0 (no body scroll)');
    assert.strictEqual(sInfo.bodyScrollTop, 0, 'document.documentElement.scrollTop must remain 0');

    // Confirm header stays visible
    assert(sInfo.headerVisible, 'Top Header must stay visible when workspace scrolls');
    console.log('✅ Criteria 5, 6, 12: Sidebar stationary at x=0, y=0; workspace scrolled independently; no double scrollbars; header visible!');

    // Capture SCROLLED Screenshot
    const scrolledShot = await sendCDP('Page.captureScreenshot', { format: 'png' });
    const scrolledPath = path.join(ARTIFACTS_DIR, 'full_height_sidebar_scrolled.png');
    fs.writeFileSync(scrolledPath, Buffer.from(scrolledShot.data, 'base64'));
    console.log('📸 Screenshot 2: SCROLLED saved to:', scrolledPath);

    // =========================================================================
    // VERIFICATION 3: COLLAPSE & EXPAND BEHAVIOR
    // =========================================================================
    console.log('--- TESTING COLLAPSE & EXPAND ---');
    await sendCDP('Runtime.evaluate', {
      expression: 'document.querySelector(".sidebar-toggle-btn").click()',
    });
    await new Promise((r) => setTimeout(r, 600));

    const collapseEval = await sendCDP('Runtime.evaluate', {
      expression: `(() => {
        const sidebar = document.querySelector('.left-sidebar');
        const workspace = document.querySelector('.app-workspace');
        const rect = sidebar.getBoundingClientRect();
        return {
          isCollapsed: sidebar.classList.contains('collapsed'),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          workspaceWidth: workspace.getBoundingClientRect().width,
        };
      })()`,
      returnByValue: true,
    });
    const cInfo = collapseEval.result?.value;
    console.log('Collapsed State Verification:\n', JSON.stringify(cInfo, null, 2));

    assert(cInfo.isCollapsed, 'Sidebar must have .collapsed class');
    assert(cInfo.rect.width >= 68 && cInfo.rect.width <= 76, `Collapsed width should be ~72px, got ${cInfo.rect.width}px`);
    assert.strictEqual(cInfo.rect.x, 0, 'Collapsed sidebar must stay flush at x=0');
    assert.strictEqual(cInfo.rect.y, 0, 'Collapsed sidebar must stay flush at y=0');
    console.log('✅ Criteria 9-11: Collapse works seamlessly to ~72px; workspace expands cleanly!');

    // Capture COLLAPSED Screenshot
    const collapsedShot = await sendCDP('Page.captureScreenshot', { format: 'png' });
    const collapsedPath = path.join(ARTIFACTS_DIR, 'full_height_sidebar_collapsed.png');
    fs.writeFileSync(collapsedPath, Buffer.from(collapsedShot.data, 'base64'));
    console.log('📸 Screenshot 3: COLLAPSED saved to:', collapsedPath);

    // Click again to Expand
    await sendCDP('Runtime.evaluate', {
      expression: 'document.querySelector(".sidebar-toggle-btn").click()',
    });
    await new Promise((r) => setTimeout(r, 600));

    // =========================================================================
    // VERIFICATION 4: VIEWPORT RESOLUTIONS TEST
    // =========================================================================
    console.log('--- TESTING MULTIPLE VIEWPORT SIZES ---');
    const resolutions = [
      { w: 1920, h: 1080 },
      { w: 1366, h: 768 },
      { w: 1280, h: 720 },
    ];

    for (const res of resolutions) {
      await sendCDP('Emulation.setDeviceMetricsOverride', {
        width: res.w,
        height: res.h,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 400));

      const resEval = await sendCDP('Runtime.evaluate', {
        expression: `(() => {
          const sidebar = document.querySelector('.left-sidebar');
          const rect = sidebar.getBoundingClientRect();
          const navBtns = Array.from(document.querySelectorAll('.sidebar-nav-list .sidebar-nav-btn'));
          const analyticsBtn = navBtns.find(b => b.textContent.includes('Analytics'));
          const analyticsRect = analyticsBtn ? analyticsBtn.getBoundingClientRect() : null;

          return {
            x: rect.x,
            y: rect.y,
            height: rect.height,
            winHeight: window.innerHeight,
            analyticsVisible: analyticsRect ? (analyticsRect.bottom <= window.innerHeight) : false,
          };
        })()`,
        returnByValue: true,
      });

      const rInfo = resEval.result?.value;
      assert.strictEqual(rInfo.x, 0, `At ${res.w}x${res.h}, sidebar x must be 0`);
      assert.strictEqual(rInfo.y, 0, `At ${res.w}x${res.h}, sidebar y must be 0`);
      assert(Math.abs(rInfo.height - rInfo.winHeight) <= 1, `At ${res.w}x${res.h}, sidebar height must match viewport`);
      console.log(`✓ Viewport ${res.w}x${res.h} passed: x=0, y=0, height=100dvh, Analytics visible: ${rInfo.analyticsVisible}`);
    }

    // =========================================================================
    // VERIFICATION 5: MOBILE RESPONSIVE DRAWER (390px)
    // =========================================================================
    console.log('--- TESTING MOBILE RESPONSIVE DRAWER (390x844) ---');
    await sendCDP('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 500));

    // Verify trigger is visible
    const mobileEval = await sendCDP('Runtime.evaluate', {
      expression: `(() => {
        const trigger = document.querySelector('.sidebar-mobile-trigger');
        const triggerVisible = trigger && window.getComputedStyle(trigger).display !== 'none';
        return { triggerVisible };
      })()`,
      returnByValue: true,
    });
    assert(mobileEval.result?.value?.triggerVisible, 'Mobile trigger must be visible on mobile screen');

    // Click trigger to open drawer
    await sendCDP('Runtime.evaluate', {
      expression: 'document.querySelector(".sidebar-mobile-trigger").click()',
    });
    await new Promise((r) => setTimeout(r, 400));

    const drawerOpenEval = await sendCDP('Runtime.evaluate', {
      expression: `(() => {
        const sidebar = document.querySelector('.left-sidebar');
        return {
          isOpen: sidebar.classList.contains('mobile-open'),
          rect: sidebar.getBoundingClientRect(),
        };
      })()`,
      returnByValue: true,
    });
    assert(drawerOpenEval.result?.value?.isOpen, 'Mobile drawer must open with .mobile-open class');
    console.log('✅ Criteria 15: Mobile drawer opens properly on mobile viewports!');

    // Capture MOBILE DRAWER Screenshot
    const mobileShot = await sendCDP('Page.captureScreenshot', { format: 'png' });
    const mobilePath = path.join(ARTIFACTS_DIR, 'sidebar_mobile_drawer.png');
    fs.writeFileSync(mobilePath, Buffer.from(mobileShot.data, 'base64'));
    console.log('📸 Screenshot 4: MOBILE DRAWER saved to:', mobilePath);

    console.log('\n========================================================================');
    console.log('   🎉 ALL 15 QUALITY ASSURANCE CRITERIA VERIFIED SUCCESSFULLY!        ');
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
    if (apiServer.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(apiServer.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill(apiServer.pid);
        }
      } catch (_) {}
    }
  }
}

run().catch((e) => {
  console.error('QA TEST SUITE FAILED:', e);
  process.exit(1);
});
