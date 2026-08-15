import path from 'node:path';
import { chromium } from 'playwright';

async function startRemoteDebug() {
  const profilePath = path.resolve(process.cwd(), '.yt-browser-profile');
  console.log('===========================================================');
  console.log('🚀 Starting Chrome Remote Debugging Server on VPS');
  console.log(`📁 Profile directory: ${profilePath}`);
  console.log('===========================================================');

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      '--remote-debugging-port=9222',
      '--remote-debugging-address=0.0.0.0',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || (await context.newPage());

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('[+] Opening https://studio.youtube.com ...');
  await page.goto('https://studio.youtube.com');

  console.log('\n✅ Remote Debugging is ACTIVE on port 9222!');
  console.log('👉 Keep this process running while you log in through chrome://inspect on your PC.');
  console.log('👉 Press Ctrl+C when you are done logging in.\n');

  // Keep process alive
  await new Promise(() => {});
}

startRemoteDebug().catch(console.error);
