import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Enhanced interactive login helper using channel: 'chrome' (your installed Google Chrome)
 * and anti-detection flags to bypass Google's "This browser or app may not be secure" block.
 */
async function loginAndSaveCookies() {
  const outputPath = path.resolve(process.cwd(), 'cookies.json');
  const userDataDir = path.resolve(process.cwd(), '.chrome-login-profile');

  console.log('===========================================================');
  console.log('🚀 YouTube Studio Authentication (Stealth Mode)');
  console.log('===========================================================');
  console.log('Opening official Google Chrome instance...');
  console.log('👉 Please log into your Google Account in the browser window.');
  console.log('👉 Complete any 2FA prompts if required.');
  console.log('👉 Once you are redirected to YouTube Studio, your session will be saved automatically.\n');

  // Launch persistent context using local Chrome binary with automation flags removed
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome', // Uses your installed Google Chrome binary
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || await context.newPage();

  // Remove navigator.webdriver flag dynamically
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });

  console.log('[*] Waiting for successful login to https://studio.youtube.com ...');

  try {
    // Wait until URL lands on studio.youtube.com without signin or accounts.google
    await page.waitForURL((url) => {
      const href = url.href;
      return href.includes('studio.youtube.com') && !href.includes('accounts.google.com') && !href.includes('/signin');
    }, { timeout: 300000 }); // 5 minutes window

    console.log('[*] Finalizing session cookies...');
    await page.waitForTimeout(4000);

    const cookies = await context.cookies();
    fs.writeFileSync(outputPath, JSON.stringify(cookies, null, 2), 'utf8');

    console.log('\n===========================================================');
    console.log(`✅ Authentication Successful!`);
    console.log(`🍪 Saved ${cookies.length} cookies to: ${outputPath}`);
    console.log('👉 You can now run headless uploads locally or copy cookies.json to your VPS.');
    console.log('===========================================================\n');
  } catch (err: any) {
    console.error(`❌ Error or timed out waiting for login: ${err.message}`);
  } finally {
    await context.close();
    // Clean up temporary local profile folder
    if (fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

loginAndSaveCookies().catch(console.error);
