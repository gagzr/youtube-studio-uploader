import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Starts a real, persistent Chromium daemon on port 9222.
 * Keeps running in the background so you never have to launch a new browser instance.
 */
async function startDaemon() {
  const profilePath = path.resolve(process.cwd(), '.yt-browser-profile');
  const port = process.env.DEBUG_PORT ? parseInt(process.env.DEBUG_PORT) : 9222;

  console.log('===========================================================');
  console.log('🌐 YouTube Studio Real Browser Daemon');
  console.log('===========================================================');
  console.log(`📁 Persistent Profile Directory: ${profilePath}`);
  console.log(`🔌 CDP Remote Debugging Port:    http://127.0.0.1:${port}`);
  console.log('===========================================================');

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=0.0.0.0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || (await context.newPage());

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('[+] Opening https://studio.youtube.com ...');
  await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });

  console.log('\n✅ Real Browser Daemon is RUNNING!');
  console.log('👉 You can now run uploads anytime with: npm run upload');
  console.log('👉 If you ever need to inspect or solve 2FA, connect via chrome://inspect on port 9222.\n');

  // Keep alive
  await new Promise(() => {});
}

startDaemon().catch(console.error);
