import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

/**
 * VPS Remote Login Server
 * Starts an HTTP server on port 3000 that streams screenshots of the VPS browser
 * and accepts mouse clicks / keyboard input so you can solve 2FA in any browser!
 */
async function startVpsLoginServer() {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const profileDir = path.resolve(process.cwd(), '.yt-browser-profile');
  const cookiesPath = path.resolve(process.cwd(), 'cookies.json');

  console.log('===========================================================');
  console.log('🚀 YouTube Studio VPS Interactive Authentication Server');
  console.log('===========================================================');
  console.log(`[+] Starting headless browser with persistent profile at: ${profileDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || (await context.newPage());

  // Mask automation
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Inject existing cookies if available
  if (fs.existsSync(cookiesPath)) {
    try {
      const raw = fs.readFileSync(cookiesPath, 'utf8');
      const cookies = JSON.parse(raw);
      if (Array.isArray(cookies)) {
        await context.addCookies(cookies.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: (c.domain || '.youtube.com').split(':')[0],
          path: c.path || '/',
        })));
        console.log('[+] Injected existing cookies.json to jumpstart session.');
      }
    } catch {}
  }

  console.log('[+] Navigating to https://studio.youtube.com ...');
  await page.goto('https://studio.youtube.com');

  // Simple Web Server to view and interact with the page
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>VPS YouTube Studio Login</title>
          <style>
            body { background: #0f172a; color: #f8fafc; font-family: sans-serif; text-align: center; margin: 0; padding: 20px; }
            #screen-wrap { display: inline-block; position: relative; border: 2px solid #38bdf8; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            #screen { display: block; max-width: 100%; cursor: crosshair; }
            .toolbar { margin: 15px auto; display: flex; gap: 10px; justify-content: center; max-width: 800px; flex-wrap: wrap; }
            input, button { padding: 10px 16px; border-radius: 6px; border: none; font-size: 14px; }
            input { width: 300px; background: #1e293b; color: #fff; border: 1px solid #475569; }
            button { background: #38bdf8; color: #0f172a; font-weight: bold; cursor: pointer; }
            button:hover { background: #7dd3fc; }
            .status { margin-bottom: 10px; color: #a5f3fc; font-weight: 500; }
          </style>
        </head>
        <body>
          <h2>🔐 VPS YouTube Authentication Stream</h2>
          <div class="status" id="url-status">Current URL: Loading...</div>
          <div class="toolbar">
            <input type="text" id="type-text" placeholder="Type text / password here..." />
            <button onclick="sendText()">⌨️ Send Text</button>
            <button onclick="sendKey('Enter')">↵ Enter</button>
            <button onclick="sendKey('Backspace')">⌫ Backspace</button>
            <button onclick="refreshScreen()">🔄 Refresh</button>
            <button onclick="saveAndExit()" style="background:#4ade80;">💾 Save Session & Finish</button>
          </div>
          <div id="screen-wrap">
            <img id="screen" src="/screenshot?t=0" onclick="handleClick(event)" />
          </div>

          <script>
            function refreshScreen() {
              const img = document.getElementById('screen');
              img.src = '/screenshot?t=' + Date.now();
              fetch('/status').then(r => r.json()).then(d => {
                document.getElementById('url-status').innerText = 'Current URL: ' + d.url;
              });
            }

            setInterval(refreshScreen, 1500);

            function handleClick(e) {
              const rect = e.target.getBoundingClientRect();
              const scaleX = 1280 / rect.width;
              const scaleY = 800 / rect.height;
              const x = Math.round((e.clientX - rect.left) * scaleX);
              const y = Math.round((e.clientY - rect.top) * scaleY);
              fetch('/click?x=' + x + '&y=' + y).then(() => setTimeout(refreshScreen, 500));
            }

            function sendText() {
              const input = document.getElementById('type-text');
              if (!input.value) return;
              fetch('/type?text=' + encodeURIComponent(input.value)).then(() => {
                input.value = '';
                setTimeout(refreshScreen, 500);
              });
            }

            function sendKey(key) {
              fetch('/key?key=' + encodeURIComponent(key)).then(() => setTimeout(refreshScreen, 500));
            }

            function saveAndExit() {
              fetch('/save').then(r => r.text()).then(msg => {
                alert(msg);
                window.close();
              });
            }
          </script>
        </body>
        </html>
      `);
      return;
    }

    if (url.pathname === '/screenshot') {
      try {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 75 });
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(buffer);
      } catch (err: any) {
        res.writeHead(500);
        res.end(err.message);
      }
      return;
    }

    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: page.url() }));
      return;
    }

    if (url.pathname === '/click') {
      const x = parseInt(url.searchParams.get('x') || '0');
      const y = parseInt(url.searchParams.get('y') || '0');
      await page.mouse.click(x, y).catch(() => {});
      res.writeHead(200);
      res.end('ok');
      return;
    }

    if (url.pathname === '/type') {
      const text = url.searchParams.get('text') || '';
      await page.keyboard.type(text).catch(() => {});
      res.writeHead(200);
      res.end('ok');
      return;
    }

    if (url.pathname === '/key') {
      const key = url.searchParams.get('key') || '';
      await page.keyboard.press(key).catch(() => {});
      res.writeHead(200);
      res.end('ok');
      return;
    }

    if (url.pathname === '/save') {
      const cookies = await context.cookies();
      fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
      console.log(`[+] Saved ${cookies.length} cookies to ${cookiesPath}`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('✅ Session & Cookies Saved Successfully! You can now close this tab.');
      setTimeout(async () => {
        await context.close();
        process.exit(0);
      }, 1000);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`\n===========================================================`);
    console.log(`🌐 VPS Web Stream Login Ready!`);
    console.log(`👉 Open in your local browser: http://YOUR_VPS_IP:${port}`);
    console.log(`👉 Or via SSH port-forward: ssh -L ${port}:127.0.0.1:${port} user@YOUR_VPS_IP`);
    console.log(`===========================================================\n`);
  });
}

startVpsLoginServer().catch(console.error);
