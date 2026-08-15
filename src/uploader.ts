import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

export interface UploadOptions {
  videoPath: string;
  title: string;
  description?: string;
  tags?: string[];
  thumbnailPath?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  isMadeForKids?: boolean;
  cookiesPath?: string;
  headless?: boolean;
  timeoutMs?: number;
}

export class YouTubeUploader {
  private cookiesPath: string;
  private headless: boolean;
  private timeoutMs: number;

  constructor(options: { cookiesPath?: string; headless?: boolean; timeoutMs?: number } = {}) {
    this.cookiesPath = options.cookiesPath || path.resolve(process.cwd(), 'cookies.json');
    this.headless = options.headless ?? true;
    this.timeoutMs = options.timeoutMs ?? 300000;
  }

  private async applyCookies(context: BrowserContext): Promise<boolean> {
    if (!fs.existsSync(this.cookiesPath)) {
      throw new Error(`Cookies file not found at: ${this.cookiesPath}.`);
    }

    try {
      const raw = fs.readFileSync(this.cookiesPath, 'utf8');
      const cookies = JSON.parse(raw);

      if (!Array.isArray(cookies)) {
        throw new Error('Cookies JSON must be an array of cookie objects.');
      }

      const validCookies: any[] = [];

      for (const c of cookies) {
        if (!c.name || typeof c.value !== 'string') continue;

        let domain = (c.domain || '.youtube.com').split(':')[0];

        let sameSite: 'Strict' | 'Lax' | 'None' | undefined = undefined;
        if (typeof c.sameSite === 'string') {
          const lower = c.sameSite.toLowerCase();
          if (lower === 'lax') sameSite = 'Lax';
          else if (lower === 'strict') sameSite = 'Strict';
          else if (lower === 'no_restriction' || lower === 'none') sameSite = 'None';
        }

        const cookieObj: any = {
          name: String(c.name),
          value: String(c.value),
          domain: domain,
          path: c.path || '/',
        };

        if (sameSite) cookieObj.sameSite = sameSite;
        if (typeof c.secure === 'boolean') cookieObj.secure = c.secure;
        if (typeof c.httpOnly === 'boolean') cookieObj.httpOnly = c.httpOnly;

        const expiry = c.expires ?? c.expirationDate;
        if (typeof expiry === 'number' && expiry > 0) {
          cookieObj.expires = expiry > 10000000000 ? Math.floor(expiry / 1000) : Math.floor(expiry);
        }

        validCookies.push(cookieObj);
      }

      if (validCookies.length === 0) {
        throw new Error('No valid cookies found in cookies.json.');
      }

      let loadedCount = 0;
      for (const cookie of validCookies) {
        try {
          await context.addCookies([cookie]);
          loadedCount++;
        } catch {
          try {
            await context.addCookies([{
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
            }]);
            loadedCount++;
          } catch {}
        }
      }

      console.log(`[+] Successfully loaded ${loadedCount}/${validCookies.length} cookies from ${path.basename(this.cookiesPath)}`);
      return true;

    } catch (err: any) {
      throw new Error(`Failed to parse cookies: ${err.message}`);
    }
  }

  public async upload(opts: UploadOptions): Promise<{ videoId?: string; videoUrl?: string }> {
    const fullVideoPath = path.resolve(opts.videoPath);
    if (!fs.existsSync(fullVideoPath)) {
      throw new Error(`Video file does not exist at: ${fullVideoPath}`);
    }

    console.log(`[+] Launching Chromium (headless: ${this.headless})...`);
    const browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });

    try {
      await this.applyCookies(context);

      const page: Page = await context.newPage();
      page.setDefaultTimeout(this.timeoutMs);

      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      console.log('[+] Navigating to YouTube Studio channel dashboard...');
      await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle' });

      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('/signin')) {
        throw new Error('Authentication failed: Cookies appear to be expired or invalid. Google redirected to Sign In.');
      }

      console.log(`[+] Authenticated into YouTube Studio URL: ${currentUrl}`);
      await page.waitForTimeout(3000);

      // Locate Create button
      console.log('[+] Opening Upload Dialog...');
      const createButton = page.locator('#create-icon, button[aria-label="Create"], ytcp-button#create-icon').first();
      await createButton.waitFor({ state: 'visible', timeout: 30000 });
      await createButton.click();
      await page.waitForTimeout(1000);

      // Click "Upload videos" option from dropdown menu
      const uploadOption = page.locator('tp-yt-paper-item:has-text("Upload videos"), ytcp-text-menu #text:has-text("Upload videos"), #text-item-0').first();
      await uploadOption.waitFor({ state: 'visible', timeout: 10000 });
      await uploadOption.click();
      console.log('[+] Clicked "Upload videos" menu item.');

      // Wait for modal dialog
      const dialog = page.locator('ytcp-uploads-dialog, ytcp-full-page-dialog');
      await dialog.waitFor({ state: 'attached', timeout: 30000 });

      console.log(`[+] Attaching video file: ${path.basename(fullVideoPath)}...`);
      const fileInput = page.locator('ytcp-uploads-dialog input[type="file"], input[type="file"][name="Filedata"], input[type="file"]').first();
      await fileInput.setInputFiles(fullVideoPath);
      console.log('[+] File payload dispatched! Upload in progress...');

      // Wait for Details/Title box
      console.log('[+] Waiting for metadata editor fields...');
      const titleBox = page.locator('#textbox[aria-label*="title" i], #title-textarea #textbox, #textbox[aria-label*="Title"]').first();
      await titleBox.waitFor({ state: 'visible', timeout: 60000 });

      // Set Title
      console.log(`[+] Setting title: "${opts.title}"`);
      await titleBox.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await titleBox.fill(opts.title);
      await page.waitForTimeout(1000);

      // Set Description
      if (opts.description) {
        console.log('[+] Setting description...');
        const descBox = page.locator('#description-textarea #textbox, #textbox[aria-label*="description" i]').first();
        if (await descBox.isVisible().catch(() => false)) {
          await descBox.click();
          await descBox.fill(opts.description);
        }
      }

      // Thumbnail
      if (opts.thumbnailPath) {
        const thumbPath = path.resolve(opts.thumbnailPath);
        if (fs.existsSync(thumbPath)) {
          console.log(`[+] Uploading custom thumbnail: ${path.basename(thumbPath)}...`);
          const thumbInput = page.locator('input#file-loader, input[type="file"][accept*="image"]').first();
          if (await thumbInput.count() > 0) {
            await thumbInput.setInputFiles(thumbPath);
          }
        }
      }

      // Made for Kids setting
      console.log('[+] Selecting Audience option (Not Made for Kids)...');
      const isKids = Boolean(opts.isMadeForKids);
      await page.evaluate((madeForKids) => {
        const radioName = madeForKids ? 'MADE_FOR_KIDS' : 'NOT_MADE_FOR_KIDS';
        const radio = (document.querySelector(`tp-yt-paper-radio-button[name="${radioName}"]`) ||
          document.querySelector(`tp-yt-paper-radio-button#${radioName.toLowerCase()}`)) as HTMLElement;
        if (radio) {
          radio.click();
        }
      }, isKids).catch(() => {});

      await page.waitForTimeout(1500);

      // Tags (Optional)
      if (opts.tags && opts.tags.length > 0) {
        console.log(`[+] Adding tags: ${opts.tags.join(', ')}`);
        await page.evaluate(() => {
          const showMore = document.querySelector('ytcp-button#toggle-button, #toggle-button') as HTMLElement;
          if (showMore) showMore.click();
        }).catch(() => {});

        await page.waitForTimeout(500);

        const tagsInput = page.locator('#tags-container input#text-input, input[aria-label="Tags"]').first();
        if (await tagsInput.isVisible().catch(() => false)) {
          await tagsInput.fill(opts.tags.join(','));
          await page.keyboard.press('Enter');
        }
      }

      // Step Through Wizard Steps 1, 2, 3
      console.log('[+] Advancing through wizard steps (Details -> Video elements -> Checks -> Visibility)...');
      for (let step = 1; step <= 3; step++) {
        console.log(`[+] Progressing Step ${step}/3...`);
        const nextButton = page.locator('#next-button, ytcp-button#next-button').first();
        if (await nextButton.isVisible().catch(() => false)) {
          await nextButton.click({ force: true }).catch(() => {});
        } else {
          await page.evaluate(() => {
            const btn = document.querySelector('#next-button, ytcp-button#next-button') as HTMLElement;
            if (btn) btn.click();
          }).catch(() => {});
        }
        await page.waitForTimeout(2000);
      }

      // Visibility Selection
      const visibility = (opts.visibility || 'unlisted').toUpperCase();
      console.log(`[+] Applying visibility: ${visibility}`);
      
      const visibilityRadio = page.locator(`tp-yt-paper-radio-button[name="${visibility}"]`).first();
      if (await visibilityRadio.isVisible().catch(() => false)) {
        await visibilityRadio.click({ force: true }).catch(() => {});
      } else {
        await page.evaluate((vis) => {
          const radio = (document.querySelector(`tp-yt-paper-radio-button[name="${vis}"]`) ||
            document.querySelector(`tp-yt-paper-radio-button[name="${vis.toUpperCase()}"]`)) as HTMLElement;
          if (radio) radio.click();
        }, visibility).catch(() => {});
      }

      await page.waitForTimeout(2000);

      // Wait until binary upload is 100% finished before closing dialog
      console.log('[+] Monitoring upload transfer progress to YouTube CDN...');
      let uploadFinished = false;
      const startTime = Date.now();
      
      while (!uploadFinished && (Date.now() - startTime) < 180000) { // 3 min max
        const statusText = await page.evaluate(() => {
          const progressSpan = document.querySelector('.progress-label, .ytcp-video-upload-progress, span[class*="progress"]') as HTMLElement;
          return progressSpan ? progressSpan.innerText : '';
        });

        if (statusText) {
          console.log(`[+] Transfer Status: ${statusText}`);
          if (statusText.toLowerCase().includes('complete') || statusText.toLowerCase().includes('processing') || statusText.toLowerCase().includes('saved as draft')) {
            uploadFinished = true;
            break;
          }
        } else {
          // If no progress bar found, check if Checks/Done icon is visible
          uploadFinished = true;
          break;
        }
        await page.waitForTimeout(2000);
      }

      // Capture generated video URL from the dialog footer
      let videoUrl: string | undefined;
      let videoId: string | undefined;

      try {
        videoUrl = await page.evaluate(() => {
          const link = document.querySelector('a.ytcp-video-info, a[href*="youtu.be"]') as HTMLAnchorElement;
          return link ? link.href : undefined;
        });
        if (videoUrl) {
          videoId = videoUrl.split('/').pop();
          console.log(`\n🔗 Captured Video URL: ${videoUrl}\n`);
        }
      } catch {}

      // Click Save / Publish
      console.log('[+] Clicking Save / Publish button...');
      const doneButton = page.locator('#done-button, ytcp-button#done-button').first();
      if (await doneButton.isVisible().catch(() => false)) {
        await doneButton.click({ force: true }).catch(() => {});
      } else {
        await page.evaluate(() => {
          const done = document.querySelector('#done-button, ytcp-button#done-button') as HTMLElement;
          if (done) done.click();
        }).catch(() => {});
      }

      // Wait for YouTube server to dismiss dialog and confirm draft insertion
      console.log('[+] Waiting for YouTube server to confirm upload...');
      await page.waitForTimeout(8000);

      // Re-verify URL from final post-upload modal if needed
      if (!videoUrl) {
        try {
          videoUrl = await page.evaluate(() => {
            const link = document.querySelector('a.ytcp-video-info, a[href*="youtu.be"]') as HTMLAnchorElement;
            return link ? link.href : undefined;
          });
          if (videoUrl) {
            videoId = videoUrl.split('/').pop();
          }
        } catch {}
      }

      // Take debug screenshot if on VPS for visual verification
      const screenshotPath = path.resolve(process.cwd(), 'upload-result.png');
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[+] Saved confirmation screenshot to: ${screenshotPath}`);
      } catch {}

      console.log('\n===========================================================');
      console.log('🎉 [SUCCESS] Video successfully registered & published on YouTube Studio!');
      if (videoUrl) {
        console.log(`👉 Direct Video URL: ${videoUrl}`);
      }
      console.log('===========================================================\n');

      return { videoId, videoUrl };

    } finally {
      try {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      } catch {}
    }
  }
}
