import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Modern Anti-Detection Chrome Daemon for YouTube Studio
 * Uses realistic Client Hints, Chrome 131 headers, and stealth overrides
 * to eliminate "Improve your experience / unsupported browser" warnings.
 */
async function startDaemon() {
  const profilePath = path.resolve(process.cwd(), '.yt-browser-profile');
  const port = process.env.DEBUG_PORT ? parseInt(process.env.DEBUG_PORT) : 9222;

  console.log('===========================================================');
  console.log('🌐 YouTube Studio Modern Stealth Daemon');
  console.log('===========================================================');
  console.log(`📁 Persistent Profile: ${profilePath}`);
  console.log(`🔌 CDP Port:           http://127.0.0.1:${port}`);
  console.log('===========================================================');

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    args: [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=0.0.0.0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || (await context.newPage());

  // Deep Stealth Injections
  await page.addInitScript(() => {
    // 1. Mask webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. Mock Chrome runtime object
    (window as any).chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
    };

    // 3. Mock valid plugins list
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // 4. Mock language preferences
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  console.log('[+] Navigating to https://studio.youtube.com ...');
  await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });

  console.log('\n✅ Stealth Daemon is ACTIVE!');
  console.log('👉 You can now run uploads anytime with: npm run upload\n');

  // Keep alive
  await new Promise(() => {});
}

startDaemon().catch(console.error);
