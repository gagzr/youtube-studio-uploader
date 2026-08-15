import path from 'node:path';
import { chromium } from 'playwright';

async function startDaemon() {
  const profilePath = path.resolve(process.cwd(), '.yt-browser-profile');
  const port = process.env.DEBUG_PORT ? parseInt(process.env.DEBUG_PORT) : 9222;

  console.log('===========================================================');
  console.log('🌐 YouTube Studio Official Chrome Daemon');
  console.log('===========================================================');
  console.log(`📁 Persistent Profile: ${profilePath}`);
  console.log(`🔌 CDP Port:           http://127.0.0.1:${port}`);
  console.log('===========================================================');

  // Try to use installed Google Chrome channel, fallback to default chromium
  let launchOptions: any = {
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=0.0.0.0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  try {
    // Attempt with channel: 'chrome' (Official Google Chrome binary)
    const context = await chromium.launchPersistentContext(profilePath, {
      ...launchOptions,
      channel: 'chrome',
    });
    initDaemonPage(context);
  } catch {
    console.log('[!] Official Chrome channel not found, using bundled Chromium engine...');
    const context = await chromium.launchPersistentContext(profilePath, launchOptions);
    initDaemonPage(context);
  }
}

async function initDaemonPage(context: any) {
  const page = context.pages()[0] || (await context.newPage());

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('[+] Navigating to https://studio.youtube.com ...');
  await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });

  console.log('\n✅ Chrome Daemon is ACTIVE on port 9222!');
  console.log('👉 You can now run uploads anytime with: npm run upload\n');

  await new Promise(() => {});
}

startDaemon().catch(console.error);
