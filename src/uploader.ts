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
    this.timeoutMs = options.timeoutMs ?? 180000;
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

      // Verify authentication
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('/signin')) {
        throw new Error('Authentication failed: Cookies appear to be expired or invalid. Google redirected to Sign In.');
      }

      console.log('[+] Authenticated successfully into YouTube Studio.');
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

      // Wait for modal dialog to attach to DOM
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

      // Made for Kids setting - scroll into view and click safely
      console.log('[+] Setting Audience options...');
      const notForKidsRadio = page.locator('tp-yt-paper-radio-button[name="NOT_MADE_FOR_KIDS"], ytcp-video-metadata-editor-audience tp-yt-paper-radio-button:has-text("No"), tp-yt-paper-radio-button:has-text("No, it\'s not made for kids")').first();
      const forKidsRadio = page.locator('tp-yt-paper-radio-button[name="MADE_FOR_KIDS"], ytcp-video-metadata-editor-audience tp-yt-paper-radio-button:has-text("Yes"), tp-yt-paper-radio-button:has-text("Yes, it\'s made for kids")').first();
      
      try {
        const targetRadio = opts.isMadeForKids ? forKidsRadio : notForKidsRadio;
        await targetRadio.scrollIntoViewIfNeeded().catch(() => {});
        await targetRadio.click({ timeout: 5000, force: true }).catch(() => {});
      } catch {}
      await page.waitForTimeout(1000);

      // Tags
      if (opts.tags && opts.tags.length > 0) {
        console.log(`[+] Adding tags: ${opts.tags.join(', ')}`);
        const showMoreBtn = page.locator('#toggle-button, ytcp-button:has-text("Show more")').first();
        if (await showMoreBtn.isVisible().catch(() => false)) {
          await showMoreBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
        }

        const tagsInput = page.locator('#tags-container input#text-input, input[aria-label="Tags"]').first();
        if (await tagsInput.isVisible().catch(() => false)) {
          await tagsInput.fill(opts.tags.join(','));
          await page.keyboard.press('Enter');
        }
      }

      // Grab Video URL
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

      // Advance through wizard steps
      console.log('[+] Advancing wizard steps (Details -> Video elements -> Checks -> Visibility)...');
      const nextBtn = page.locator('#next-button, ytcp-button#next-button').first();

      for (let i = 1; i <= 3; i++) {
        if (await nextBtn.isVisible().catch(() => false)) {
          await nextBtn.click({ force: true });
          await page.waitForTimeout(1500);
        }
      }

      // Visibility
      const visibility = opts.visibility || 'unlisted';
      console.log(`[+] Setting visibility: ${visibility.toUpperCase()}`);

      const visibilityRadio = page.locator(`tp-yt-paper-radio-button[name="${visibility.toUpperCase()}"]`).first();
      if (await visibilityRadio.isVisible().catch(() => false)) {
        await visibilityRadio.click({ force: true });
      } else {
        const textRadio = page.locator(`tp-yt-paper-radio-button:has-text("${visibility}")`).first();
        await textRadio.click({ force: true }).catch(() => {});
      }
      await page.waitForTimeout(1000);

      // Save / Publish
      console.log('[+] Publishing video...');
      const doneBtn = page.locator('#done-button, ytcp-button#done-button').first();
      await doneBtn.click({ force: true });

      await page.waitForTimeout(5000);

      console.log('🎉 [SUCCESS] Video upload complete!');
      return { videoId, videoUrl };

    } finally {
      await context.close();
      await browser.close();
    }
  }
}
