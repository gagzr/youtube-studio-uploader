import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface UploadOptions {
  videoPath: string;
  title: string;
  description?: string;
  tags?: string[];
  thumbnailPath?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  isMadeForKids?: boolean;
  cdpEndpoint?: string;
  profileDir?: string;
  timeoutMs?: number;
}

export class YouTubeUploader {
  private cdpEndpoint: string;
  private profileDir: string;
  private timeoutMs: number;

  constructor(options: { cdpEndpoint?: string; profileDir?: string; timeoutMs?: number } = {}) {
    this.cdpEndpoint = options.cdpEndpoint || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
    this.profileDir = options.profileDir || path.resolve(process.cwd(), '.yt-browser-profile');
    this.timeoutMs = options.timeoutMs ?? 300000;
  }

  private async getBrowserContext(): Promise<{ browser?: Browser; context: BrowserContext; isAttachedCDP: boolean }> {
    try {
      console.log(`[+] Connecting to running browser instance at: ${this.cdpEndpoint}...`);
      const browser = await chromium.connectOverCDP(this.cdpEndpoint, { timeout: 5000 });
      const context = browser.contexts()[0] || (await browser.newContext());
      console.log('[+] Successfully attached to existing persistent Chrome session!');
      return { browser, context, isAttachedCDP: true };
    } catch {
      console.log(`[!] No running daemon found at ${this.cdpEndpoint}. Launching persistent context directly...`);
      const context = await chromium.launchPersistentContext(this.profileDir, {
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: [
          '--remote-debugging-port=9222',
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
      return { context, isAttachedCDP: false };
    }
  }

  public async upload(opts: UploadOptions): Promise<{ videoId?: string; videoUrl?: string }> {
    const fullVideoPath = path.resolve(opts.videoPath);
    if (!fs.existsSync(fullVideoPath)) {
      throw new Error(`Video file does not exist at: ${fullVideoPath}`);
    }

    const { browser, context, isAttachedCDP } = await this.getBrowserContext();

    try {
      const page: Page = await context.newPage();
      page.setDefaultTimeout(this.timeoutMs);

      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      console.log('[+] Navigating to YouTube Studio (https://studio.youtube.com)...');
      await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });

      // Check for Google Security Challenge & allow live user takeover
      let currentUrl = page.url();
      if (
        currentUrl.includes('signin/v2/challenge') ||
        currentUrl.includes('challenge') ||
        currentUrl.includes('accounts.google.com')
      ) {
        const challengeScreenshot = path.resolve(process.cwd(), 'security-challenge.png');
        await page.screenshot({ path: challengeScreenshot, fullPage: true }).catch(() => {});

        console.log('\n===========================================================');
        console.log('⚠️  GOOGLE VERIFICATION PROMPT DETECTED ("Verify it\'s you")');
        console.log('===========================================================');
        console.log(`📸 Screenshot saved to: ${challengeScreenshot}`);
        console.log('👉 TAKE OVER THE SESSION:');
        console.log('   1. Forward port 9222 from your PC: ssh -L 9222:127.0.0.1:9222 root@YOUR_VPS_IP');
        console.log('   2. Open Chrome on PC -> chrome://inspect -> Click "inspect" on YouTube Studio.');
        console.log('   3. Solve the 2FA prompt on your screen.');
        console.log('⏳ Pausing execution for up to 2 minutes waiting for verification to complete...\n');

        let verified = false;
        for (let wait = 0; wait < 40; wait++) {
          await page.waitForTimeout(3000);
          currentUrl = page.url();
          if (currentUrl.includes('studio.youtube.com') && !currentUrl.includes('accounts.google.com')) {
            verified = true;
            console.log('✅ Google Verification complete! Resuming automated upload...\n');
            break;
          }
        }

        if (!verified) {
          throw new Error('Timed out waiting for manual verification takeover.');
        }
      }

      console.log(`[+] Authenticated into YouTube Studio URL: ${currentUrl}`);
      await page.waitForTimeout(3000);

      // Open Create -> Upload Dialog
      console.log('[+] Opening Upload Dialog...');
      
      // Try multiple selectors for Create button (Header icon or direct upload widget)
      const opened = await page.evaluate(() => {
        const createBtn = document.querySelector('#create-icon, button[aria-label="Create"], ytcp-button#create-icon, ytcp-button#upload-icon') as HTMLElement;
        if (createBtn) {
          createBtn.click();
          return true;
        }
        return false;
      });

      if (!opened) {
        const createButton = page.locator('#create-icon, button[aria-label="Create"], ytcp-button#create-icon, #upload-icon').first();
        await createButton.waitFor({ state: 'attached', timeout: 30000 });
        await createButton.click({ force: true });
      }

      await page.waitForTimeout(1000);

      // Click "Upload videos" option from dropdown menu if dropdown appeared
      await page.evaluate(() => {
        const uploadOption = document.querySelector('tp-yt-paper-item:has-text("Upload videos"), ytcp-text-menu #text:has-text("Upload videos"), #text-item-0') as HTMLElement;
        if (uploadOption) uploadOption.click();
      }).catch(() => {});

      // Wait for modal dialog
      const dialog = page.locator('ytcp-uploads-dialog, ytcp-full-page-dialog');
      await dialog.waitFor({ state: 'attached', timeout: 30000 });

      console.log(`[+] Attaching video file: ${path.basename(fullVideoPath)}...`);
      const fileInput = page.locator('ytcp-uploads-dialog input[type="file"], input[type="file"][name="Filedata"], input[type="file"]').first();
      await fileInput.setInputFiles(fullVideoPath);
      console.log('[+] File payload dispatched! Upload in progress...');

      // Wait for Details/Title box (attached state)
      console.log('[+] Waiting for metadata editor fields...');
      const titleBox = page.locator('#textbox[aria-label*="title" i], #title-textarea #textbox, #textbox[aria-label*="Title"]').first();
      await titleBox.waitFor({ state: 'attached', timeout: 60000 });

      // Set Title
      console.log(`[+] Setting title: "${opts.title}"`);
      await page.evaluate((newTitle) => {
        const titleEl = document.querySelector('#textbox[aria-label*="title" i], #title-textarea #textbox, #textbox[aria-label*="Title"]') as HTMLElement;
        if (titleEl) {
          titleEl.focus();
          titleEl.textContent = newTitle;
          titleEl.innerText = newTitle;
          titleEl.dispatchEvent(new Event('input', { bubbles: true }));
          titleEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, opts.title);

      await page.waitForTimeout(1500);

      // Set Description
      if (opts.description) {
        console.log('[+] Setting description...');
        await page.evaluate((newDesc) => {
          const descEl = document.querySelector('#description-textarea #textbox, #textbox[aria-label*="description" i]') as HTMLElement;
          if (descEl) {
            descEl.focus();
            descEl.textContent = newDesc;
            descEl.innerText = newDesc;
            descEl.dispatchEvent(new Event('input', { bubbles: true }));
            descEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, opts.description);
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

      // Take debug screenshot
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
      if (isAttachedCDP) {
        console.log('[+] Finished upload task. Keeping persistent Chrome daemon active.');
        try {
          const page = context.pages()[0];
          if (page) await page.close().catch(() => {});
        } catch {}
      } else {
        try {
          await context.close().catch(() => {});
        } catch {}
      }
    }
  }
}
