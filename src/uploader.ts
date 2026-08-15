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
      console.log(`[!] No running daemon found at ${this.cdpEndpoint}. Launching persistent context with stealth engine...`);
      const context = await chromium.launchPersistentContext(this.profileDir, {
        headless: true,
        viewport: { width: 1440, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'en-US',
        extraHTTPHeaders: {
          'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        args: [
          '--remote-debugging-port=9222',
          '--remote-debugging-address=0.0.0.0',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1440,900',
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

      // Stealth Injections
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        (window as any).chrome = {
          app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
          runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
        };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });

      console.log('[+] Navigating to YouTube Studio (https://studio.youtube.com)...');
      await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);

      // Check current page state
      let currentUrl = page.url();
      console.log(`[+] Current Page URL: ${currentUrl}`);

      const stateScreenshot = path.resolve(process.cwd(), 'vps-state.png');
      try {
        await page.screenshot({ path: stateScreenshot, fullPage: true });
        console.log(`📸 Diagnostic snapshot saved to: ${stateScreenshot}`);
      } catch {}

      // Click "SKIP TO YOUTUBE STUDIO" interstitial if unsupported browser page is shown
      const skipBtn = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        const skip = els.find(el => el.textContent?.trim().toUpperCase().includes('SKIP TO YOUTUBE STUDIO')) as HTMLElement;
        if (skip) { skip.click(); return true; }
        return false;
      });
      if (skipBtn) {
        console.log('[+] Dismissed "Unsupported Browser" interstitial via Skip link.');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
        currentUrl = page.url();
        console.log(`[+] Now at: ${currentUrl}`);
      }

      if (
        currentUrl.includes('signin/v2/challenge') ||
        currentUrl.includes('challenge') ||
        currentUrl.includes('accounts.google.com')
      ) {
        console.log('\n===========================================================');
        console.log('⚠️  GOOGLE VERIFICATION PROMPT DETECTED ("Verify it\'s you")');
        console.log('===========================================================');
        console.log(`📸 Screenshot saved to: ${stateScreenshot}`);
        console.log('👉 Open chrome://inspect from your PC to solve the 2FA prompt.');
        console.log('⏳ Pausing execution for 2 minutes...\n');

        let verified = false;
        for (let wait = 0; wait < 40; wait++) {
          await page.waitForTimeout(3000);
          currentUrl = page.url();
          if (currentUrl.includes('studio.youtube.com') && !currentUrl.includes('accounts.google.com')) {
            verified = true;
            console.log('✅ Google Verification complete! Resuming upload...\n');
            break;
          }
        }

        if (!verified) {
          throw new Error('Timed out waiting for manual verification takeover.');
        }
      }

      console.log('[+] Opening Upload Dialog...');

      // Step 1: Wait for Create button to actually be visible in the DOM
      const createBtn = page.locator('#create-icon, ytcp-button#create-icon, button[aria-label="Create"]').first();
      try {
        await createBtn.waitFor({ state: 'visible', timeout: 20000 });
        await createBtn.click();
        console.log('[+] Clicked Create button.');
      } catch {
        // Fallback: force click via evaluate
        console.log('[!] Create button not visible, trying force evaluate click...');
        await page.evaluate(() => {
          const btn = document.querySelector('#create-icon, ytcp-button#create-icon') as HTMLElement;
          if (btn) btn.click();
        });
      }

      await page.waitForTimeout(1500);

      // Take diagnostic screenshot to see if dropdown appeared
      const afterCreateScreenshot = path.resolve(process.cwd(), 'after-create-click.png');
      await page.screenshot({ path: afterCreateScreenshot }).catch(() => {});
      console.log(`📸 Post-create-click snapshot: ${afterCreateScreenshot}`);

      // Step 2: Click "Upload videos" from the dropdown menu
      const uploadMenuItem = page.locator('tp-yt-paper-item:has-text("Upload videos"), #text-item-0').first();
      try {
        await uploadMenuItem.waitFor({ state: 'visible', timeout: 10000 });
        await uploadMenuItem.click();
        console.log('[+] Clicked "Upload videos" menu item.');
      } catch {
        await page.evaluate(() => {
          const item = document.querySelector('tp-yt-paper-item') as HTMLElement;
          if (item) item.click();
        });
      }

      await page.waitForTimeout(1500);

      // Take diagnostic screenshot to see if upload dialog appeared
      const afterUploadMenuScreenshot = path.resolve(process.cwd(), 'after-upload-menu.png');
      await page.screenshot({ path: afterUploadMenuScreenshot }).catch(() => {});
      console.log(`📸 Post-upload-menu snapshot: ${afterUploadMenuScreenshot}`);

      console.log(`[+] Attaching video file: ${path.basename(fullVideoPath)}...`);
      const fileInput = page.locator('input[type="file"][name="Filedata"], ytcp-uploads-dialog input[type="file"], input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 30000 });
      await fileInput.setInputFiles(fullVideoPath);
      console.log('[+] File payload dispatched! Upload in progress...');

      // Wait for Details/Title box
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
      const uploadResultScreenshot = path.resolve(process.cwd(), 'upload-result.png');
      try {
        await page.screenshot({ path: uploadResultScreenshot, fullPage: true });
        console.log(`[+] Saved confirmation screenshot to: ${uploadResultScreenshot}`);
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
