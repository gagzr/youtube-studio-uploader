import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Interactive helper to open a visible browser, let the user log into Google / YouTube,
 * and automatically dump session cookies to cookies.json.
 */
async function loginAndSaveCookies() {
  const outputPath = path.resolve(process.cwd(), 'cookies.json');

  console.log('===========================================================');
  console.log('🚀 YouTube Studio Authentication Helper');
  console.log('===========================================================');
  console.log('Opening browser window...');
  console.log('👉 Please log into your Google Account / YouTube Channel in the browser window.');
  console.log('👉 Complete any 2FA prompts if required.');
  console.log('👉 Once you are redirected to YouTube Studio, your session will be saved automatically.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto('https://studio.youtube.com');

  // Wait until the user reaches studio.youtube.com and is logged in
  console.log('[*] Waiting for successful login to https://studio.youtube.com ...');

  try {
    // Poll until we see studio.youtube.com dashboard without /signin or accounts.google
    await page.waitForURL((url) => {
      const href = url.href;
      return href.includes('studio.youtube.com') && !href.includes('accounts.google.com') && !href.includes('/signin');
    }, { timeout: 300000 }); // 5 minute window for user to sign in

    // Wait a couple seconds for all session cookies to be written
    await page.waitForTimeout(4000);

    const cookies = await context.cookies();
    fs.writeFileSync(outputPath, JSON.stringify(cookies, null, 2), 'utf8');

    console.log('\n===========================================================');
    console.log(`✅ Authentication Successful!`);
    console.log(`🍪 Saved ${cookies.length} cookies to: ${outputPath}`);
    console.log('👉 You can now transfer `cookies.json` to your VPS or run headless uploads directly.');
    console.log('===========================================================\n');
  } catch (err: any) {
    console.error(`❌ Error or timed out waiting for login: ${err.message}`);
  } finally {
    await browser.close();
  }
}

loginAndSaveCookies().catch(console.error);
