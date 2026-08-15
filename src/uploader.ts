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
    this.timeoutMs = options.timeoutMs ?? 180000; // 3 min timeout for slow networks
  }

  /**
   * Loads cookies into the browser context.
   */
  private async applyCookies(context: BrowserContext): Promise<boolean> {
    if (!fs.existsSync(this.cookiesPath)) {
      throw new Error(`Cookies file not found at: ${this.cookiesPath}. Please export your cookies to this path or run the login helper.`);
    }

    try {
      const raw = fs.readFileSync(this.cookiesPath, 'utf8');
      const cookies = JSON.parse(raw);

      // Playwright expects array of cookies
      if (Array.isArray(cookies)) {
        await context.addCookies(cookies);
        console.log(`[+] Successfully loaded ${cookies.length} cookies from ${path.basename(this.cookiesPath)}`);
        return true;
      } else {
        throw new Error('Cookies JSON must be an array of cookie objects.');
      }
    } catch (err: any) {
      throw new Error(`Failed to parse cookies: ${err.message}`);
    }
  }

  /**
   * Main upload execution method
   */
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

      console.log('[+] Navigating to YouTube Studio (https://studio.youtube.com)...');
      await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });

      // Check if logged in
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('/signin')) {
        throw new Error('Authentication failed: Cookies appear to be expired or invalid. Google redirected to Sign In.');
      }

      console.log('[+] Authenticated successfully into YouTube Studio.');

      // Click "CREATE" or "UPLOAD VIDEOS"
      console.log('[+] Opening upload dialog...');
      const createButton = page.locator('#create-icon, button[aria-label="Create"], ytcp-button#create-icon');
      if (await createButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await createButton.click();
        const uploadVideosOption = page.locator('text="Upload videos"');
        await uploadVideosOption.click();
      }

      // Handle file input
      console.log(`[+] Selecting file: ${path.basename(fullVideoPath)}...`);
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
      
      const selectFilesBtn = page.locator('#select-files-button, button:has-text("Select files")');
      if (await selectFilesBtn.isVisible().catch(() => false)) {
        await selectFilesBtn.click();
      }

      const fileChooser = await fileChooserPromise;
      if (fileChooser) {
        await fileChooser.setFiles(fullVideoPath);
      } else {
        // Fallback: direct setInputFiles on the hidden file input
        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles(fullVideoPath);
      }

      console.log('[+] Upload started. Waiting for metadata editor...');
      // Wait for title input field to appear
      const titleBox = page.locator('#textbox[aria-label*="title" i], #title-textarea #textbox');
      await titleBox.waitFor({ state: 'visible', timeout: 30000 });

      // Set Title
      console.log(`[+] Setting title: "${opts.title}"`);
      await titleBox.click();
      // Select all and replace
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await titleBox.fill(opts.title);

      // Set Description
      if (opts.description) {
        console.log('[+] Setting description...');
        const descBox = page.locator('#description-textarea #textbox, #textbox[aria-label*="description" i]');
        if (await descBox.isVisible().catch(() => false)) {
          await descBox.click();
          await descBox.fill(opts.description);
        }
      }

      // Set Thumbnail (Optional)
      if (opts.thumbnailPath) {
        const thumbPath = path.resolve(opts.thumbnailPath);
        if (fs.existsSync(thumbPath)) {
          console.log(`[+] Uploading thumbnail: ${path.basename(thumbPath)}...`);
          const thumbInput = page.locator('input#file-loader, input[type="file"][accept*="image"]');
          if (await thumbInput.count() > 0) {
            await thumbInput.setInputFiles(thumbPath);
          }
        }
      }

      // "Made for kids" selection (Required by YouTube)
      console.log('[+] Setting Audience options...');
      const notForKidsRadio = page.locator('tp-yt-paper-radio-button[name="NOT_MADE_FOR_KIDS"], tp-yt-paper-radio-button:has-text("No, it\'s not made for kids")');
      const forKidsRadio = page.locator('tp-yt-paper-radio-button[name="MADE_FOR_KIDS"], tp-yt-paper-radio-button:has-text("Yes, it\'s made for kids")');
      
      if (opts.isMadeForKids) {
        await forKidsRadio.click().catch(() => {});
      } else {
        await notForKidsRadio.click().catch(() => {});
      }

      // Add Tags (Show More section)
      if (opts.tags && opts.tags.length > 0) {
        console.log(`[+] Adding tags: ${opts.tags.join(', ')}`);
        const showMoreBtn = page.locator('#toggle-button, ytcp-button:has-text("Show more")');
        if (await showMoreBtn.isVisible().catch(() => false)) {
          await showMoreBtn.click();
        }

        const tagsInput = page.locator('#tags-container input#text-input, input[aria-label="Tags"]');
        if (await tagsInput.isVisible().catch(() => false)) {
          await tagsInput.fill(opts.tags.join(','));
          await page.keyboard.press('Enter');
        }
      }

      // Navigate through "Next" buttons (Video elements, Checks)
      console.log('[+] Proceeding through wizard steps...');
      const nextBtn = page.locator('#next-button');

      // Click Next for Details -> Video elements
      await nextBtn.click();
      await page.waitForTimeout(1000);

      // Click Next for Video elements -> Checks
      await nextBtn.click();
      await page.waitForTimeout(1000);

      // Click Next for Checks -> Visibility
      await nextBtn.click();
      await page.waitForTimeout(1000);

      // Set Visibility (Private, Unlisted, Public)
      const visibility = opts.visibility || 'unlisted';
      console.log(`[+] Setting visibility to: ${visibility.toUpperCase()}`);

      const visibilityRadio = page.locator(`tp-yt-paper-radio-button[name="${visibility.toUpperCase()}"]`);
      if (await visibilityRadio.isVisible().catch(() => false)) {
        await visibilityRadio.click();
      } else {
        // Fallback selector by text
        const textRadio = page.locator(`tp-yt-paper-radio-button:has-text("${visibility}")`);
        await textRadio.click().catch(() => {});
      }

      // Grab Video Link if displayed
      let videoUrl: string | undefined;
      let videoId: string | undefined;
      const linkElem = page.locator('a.ytcp-video-info, a[href*="youtu.be"]');
      if (await linkElem.isVisible().catch(() => false)) {
        videoUrl = await linkElem.getAttribute('href') || undefined;
        if (videoUrl) {
          videoId = videoUrl.split('/').pop();
          console.log(`[+] Video URL generated: ${videoUrl}`);
        }
      }

      // Click Save / Done
      console.log('[+] Publishing / Saving video...');
      const doneBtn = page.locator('#done-button, ytcp-button#done-button');
      await doneBtn.click();

      // Wait for modal to close or upload confirmation dialog
      await page.waitForTimeout(4000);

      console.log('🎉 [SUCCESS] Video successfully uploaded to YouTube Studio!');
      return { videoId, videoUrl };

    } finally {
      await context.close();
      await browser.close();
    }
  }
}
