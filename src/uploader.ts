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
    this.timeoutMs = options.timeoutMs ?? 180000; // 3 min timeout
  }

  private async applyCookies(context: BrowserContext): Promise<boolean> {
    if (!fs.existsSync(this.cookiesPath)) {
      throw new Error(`Cookies file not found at: ${this.cookiesPath}.`);
    }

    try {
      const raw = fs.readFileSync(this.cookiesPath, 'utf8');
      const cookies = JSON.parse(raw);

      if (Array.isArray(cookies)) {
        // Clean cookie objects for Playwright compatibility
        const validCookies = cookies.map((c: any) => {
          const cookie: any = {
            name: c.name,
            value: c.value,
            domain: c.domain?.startsWith('.') ? c.domain : `.${c.domain || 'youtube.com'}`,
            path: c.path || '/',
          };
          if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) {
            cookie.sameSite = c.sameSite;
          }
          if (typeof c.secure === 'boolean') {
            cookie.secure = c.secure;
          }
          if (typeof c.httpOnly === 'boolean') {
            cookie.httpOnly = c.httpOnly;
          }
          if (c.expirationDate && typeof c.expirationDate === 'number') {
            cookie.expires = c.expirationDate;
          }
          return cookie;
        });

        await context.addCookies(validCookies);
        console.log(`[+] Successfully loaded ${validCookies.length} cookies from ${path.basename(this.cookiesPath)}`);
        return true;
      } else {
        throw new Error('Cookies JSON must be an array.');
      }
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

      // Mask automation flags
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      console.log('[+] Navigating to YouTube Studio (https://studio.youtube.com)...');
      await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });

      // Check if logged in
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('/signin')) {
        throw new Error('Authentication failed: Cookies appear to be expired or invalid. Google redirected to Sign In.');
      }

      console.log('[+] Authenticated successfully into YouTube Studio.');
      await page.waitForTimeout(3000);

      // Open Create -> Upload Dialog
      console.log('[+] Opening upload dialog...');
      const createBtn = page.locator('#create-icon, ytcp-button#create-icon, button[aria-label="Create"]').first();
      if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(1000);
        const uploadOption = page.locator('#text-item-0, ytcp-text-menu #text:has-text("Upload videos"), text="Upload videos"').first();
        if (await uploadOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await uploadOption.click();
        }
      } else {
        // Direct upload button on channel dashboard
        const uploadBtnDirect = page.locator('#upload-icon, ytcp-button#upload-icon, button:has-text("Upload videos")').first();
        if (await uploadBtnDirect.isVisible({ timeout: 3000 }).catch(() => false)) {
          await uploadBtnDirect.click();
        }
      }

      console.log(`[+] Setting file payload: ${path.basename(fullVideoPath)}...`);
      
      // Look for the file input element in the upload dialog and attach file directly
      const fileInput = page.locator('input[type="file"][name="Filedata"], input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 30000 });
      await fileInput.setInputFiles(fullVideoPath);
      console.log('[+] File attached. Uploading file to YouTube...');

      // Wait for Details/Title editor to populate
      console.log('[+] Waiting for metadata editor...');
      const titleBox = page.locator('#textbox[aria-label*="title" i], #title-textarea #textbox').first();
      await titleBox.waitFor({ state: 'visible', timeout: 60000 });

      // Fill Title
      console.log(`[+] Setting title: "${opts.title}"`);
      await titleBox.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await titleBox.fill(opts.title);
      await page.waitForTimeout(1000);

      // Fill Description (Optional)
      if (opts.description) {
        console.log('[+] Setting description...');
        const descBox = page.locator('#description-textarea #textbox, #textbox[aria-label*="description" i]').first();
        if (await descBox.isVisible().catch(() => false)) {
          await descBox.click();
          await descBox.fill(opts.description);
        }
      }

      // Thumbnail (Optional)
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

      // Audience: "Made for kids"
      console.log('[+] Setting Audience options...');
      const notForKidsRadio = page.locator('tp-yt-paper-radio-button[name="NOT_MADE_FOR_KIDS"], tp-yt-paper-radio-button:has-text("No, it\'s not made for kids")').first();
      const forKidsRadio = page.locator('tp-yt-paper-radio-button[name="MADE_FOR_KIDS"], tp-yt-paper-radio-button:has-text("Yes, it\'s made for kids")').first();
      
      if (opts.isMadeForKids) {
        await forKidsRadio.click().catch(() => {});
      } else {
        await notForKidsRadio.click().catch(() => {});
      }
      await page.waitForTimeout(1000);

      // Tags (Optional)
      if (opts.tags && opts.tags.length > 0) {
        console.log(`[+] Adding tags: ${opts.tags.join(', ')}`);
        const showMoreBtn = page.locator('#toggle-button, ytcp-button:has-text("Show more")').first();
        if (await showMoreBtn.isVisible().catch(() => false)) {
          await showMoreBtn.click();
          await page.waitForTimeout(500);
        }

        const tagsInput = page.locator('#tags-container input#text-input, input[aria-label="Tags"]').first();
        if (await tagsInput.isVisible().catch(() => false)) {
          await tagsInput.fill(opts.tags.join(','));
          await page.keyboard.press('Enter');
        }
      }

      // Grab Video URL if already generated
      let videoUrl: string | undefined;
      let videoId: string | undefined;
      const linkElem = page.locator('a.ytcp-video-info, a[href*="youtu.be"]').first();
      if (await linkElem.isVisible().catch(() => false)) {
        videoUrl = await linkElem.getAttribute('href') || undefined;
        if (videoUrl) {
          videoId = videoUrl.split('/').pop();
          console.log(`[+] Generated Video URL: ${videoUrl}`);
        }
      }

      // Navigate Next buttons
      console.log('[+] Navigating wizard steps (Details -> Video elements -> Checks -> Visibility)...');
      const nextBtn = page.locator('#next-button, ytcp-button#next-button').first();

      for (let step = 1; step <= 3; step++) {
        if (await nextBtn.isVisible().catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(1500);
        }
      }

      // Set Visibility
      const visibility = opts.visibility || 'unlisted';
      console.log(`[+] Setting visibility: ${visibility.toUpperCase()}`);

      const visibilityRadio = page.locator(`tp-yt-paper-radio-button[name="${visibility.toUpperCase()}"]`).first();
      if (await visibilityRadio.isVisible().catch(() => false)) {
        await visibilityRadio.click();
      } else {
        const textRadio = page.locator(`tp-yt-paper-radio-button:has-text("${visibility}")`).first();
        await textRadio.click().catch(() => {});
      }
      await page.waitForTimeout(1000);

      // Click Done / Save
      console.log('[+] Saving and publishing...');
      const doneBtn = page.locator('#done-button, ytcp-button#done-button').first();
      await doneBtn.click();

      // Wait for completion dialog or modal to finish
      await page.waitForTimeout(5000);

      console.log('🎉 [SUCCESS] Video upload complete!');
      return { videoId, videoUrl };

    } finally {
      await context.close();
      await browser.close();
    }
  }
}
