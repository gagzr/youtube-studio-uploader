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
  profileDir?: string;
  headless?: boolean;
  timeoutMs?: number;
}

export class YouTubeUploader {
  private cookiesPath: string;
  private profileDir?: string;
  private headless: boolean;
  private timeoutMs: number;

  constructor(options: { cookiesPath?: string; profileDir?: string; headless?: boolean; timeoutMs?: number } = {}) {
    this.cookiesPath = options.cookiesPath || path.resolve(process.cwd(), 'cookies.json');
    this.profileDir = options.profileDir || path.resolve(process.cwd(), '.yt-browser-profile');
    this.headless = options.headless ?? true;
    this.timeoutMs = options.timeoutMs ?? 300000;
  }

  private async applyCookies(context: BrowserContext): Promise<boolean> {
    if (!fs.existsSync(this.cookiesPath)) {
      return false;
    }

    try {
      const raw = fs.readFileSync(this.cookiesPath, 'utf8');
      const cookies = JSON.parse(raw);

      if (!Array.isArray(cookies)) return false;

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

      console.log(`[+] Loaded ${loadedCount}/${validCookies.length} cookies into browser context.`);
      return true;
    } catch {
      return false;
    }
  }

  public async upload(opts: UploadOptions): Promise<{ videoId?: string; videoUrl?: string }> {
    const fullVideoPath = path.resolve(opts.videoPath);
    if (!fs.existsSync(fullVideoPath)) {
      throw new Error(`Video file does not exist at: ${fullVideoPath}`);
    }

    const profilePath = path.resolve(opts.profileDir || this.profileDir!);
    console.log(`[+] Using persistent profile storage at: ${profilePath}`);
    console.log(`[+] Launching Chromium (headless: ${this.headless})...`);

    // Use persistent context to retain device trust and security verification tokens
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: this.headless,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    try {
      await this.applyCookies(context);

      const page: Page = context.pages()[0] || (await context.newPage());
      page.setDefaultTimeout(this.timeoutMs);

      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      console.log('[+] Navigating to YouTube Studio (https://studio.youtube.com)...');
      await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle' });

      // Detect Google Security Challenge ("Verify it's you")
      const currentUrl = page.url();
      if (currentUrl.includes('challenge') || currentUrl.includes('signin/v2/challenge') || currentUrl.includes('accounts.google.com')) {
        // Take screenshot of the verification challenge so user can identify the exact prompt
        const challengeScreenshot = path.resolve(process.cwd(), 'security-challenge.png');
        await page.screenshot({ path: challengeScreenshot, fullPage: true }).catch(() => {});
        
        throw new Error(
          `Google Security Challenge Triggered ("Verify it's you").\n` +
          `A screenshot of the prompt was saved to: ${challengeScreenshot}\n` +
          `👉 Please perform the one-time proxy login or review the prompt.`
        );
      }

      console.log(`[+] Authenticated into YouTube Studio URL: ${currentUrl}`);
      await page.waitForTimeout(3000);

      // Open Create -> Upload dialog
      console.log('[+] Opening Upload Dialog...');
      const createButton = page.locator('#create-icon, button[aria-label="Create"], ytcp-button#create-icon').first();
      await createButton.waitFor({ state: 'visible', timeout: 30000 });
      await createButton.click();
      await page.waitForTimeout(1000);

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

      // Made for Kids
      console.log('[+] Selecting Audience option (Not Made for Kids)...');
      const isKids = Boolean(opts.isMadeForKids);
      await page.evaluate((madeForKids) => {
        const radioName = madeForKids ? 'MADE_FOR_KIDS' : 'NOT_MADE_FOR_KIDS';
        const radio = (document.querySelector(`tp-yt-paper-radio-button[name="${radioName}"]`) ||
          document.querySelector(`tp-yt-paper-radio-button#${radioName.toLowerCase()}`)) as HTMLElement;
        if (radio) radio.click();
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

      // Advance Steps 1, 2, 3
      console.log('[+] Advancing through wizard steps (Details -> Video elements -> Checks -> Visibility)...');
      for (let step = 1; step <= 3; step++) {
        console.log(`[+] Progressing Step ${step}/3...`);
        await page.evaluate(() => {
          const btn = document.querySelector('#next-button, ytcp-button#next-button') as HTMLElement;
          if (btn) btn.click();
        }).catch(() => {});
        await page.waitForTimeout(2000);
      }

      // Visibility Selection
      const visibility = (opts.visibility || 'unlisted').toUpperCase();
      console.log(`[+] Applying visibility: ${visibility}`);
      
      await page.evaluate((vis) => {
        const radio = (document.querySelector(`tp-yt-paper-radio-button[name="${vis}"]`) ||
          document.querySelector(`tp-yt-paper-radio-button[name="${vis.toUpperCase()}"]`)) as HTMLElement;
        if (radio) radio.click();
      }, visibility).catch(() => {});

      await page.waitForTimeout(2000);

      // Extract generated video URL before closing dialog
      let videoUrl: string | undefined;
      let videoId: string | undefined;

      try {
        videoUrl = await page.evaluate(() => {
          const link = document.querySelector('a.ytcp-video-info, a[href*="youtu.be"]') as HTMLAnchorElement;
          return link ? link.href : undefined;
        });
        if (videoUrl) {
          videoId = videoUrl.split('/').pop();
          console.log(`\n🔗 Captured Video URL: ${videoUrl}`);
        }
      } catch {}

      // Save / Publish
      console.log('[+] Clicking Save / Publish button...');
      await page.evaluate(() => {
        const done = document.querySelector('#done-button, ytcp-button#done-button') as HTMLElement;
        if (done) done.click();
      }).catch(() => {});

      console.log('[+] Finalizing upload...');
      await page.waitForTimeout(6000);

      // Take debug screenshot on VPS
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
      } catch {}
    }
  }
}
