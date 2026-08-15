# 🚀 YouTube Studio Headless VPS Uploader

Automate video uploads directly to **YouTube Studio** using Playwright. Bypasses the YouTube Data API v3 daily upload quota limits by running headlessly on any VPS (Linux) or local machine (Windows/macOS).

---

## 📦 Features

- **No YouTube API Quotas**: Uploads via YouTube Studio web interface just like a browser.
- **VPS Ready**: Completely headless mode support with anti-detection flags.
- **Full Metadata Support**: Set Title, Description, Tags, Custom Thumbnails, Made for Kids status, and Visibility (Public, Unlisted, Private).
- **Cookie Authentication**: Extract your session once from your local computer and drop `cookies.json` onto your VPS.

---

## 🛠️ Step 1: Install Dependencies

```bash
cd youtube-studio-uploader
npm install
npx playwright install chromium
```

*(On a Linux VPS, also run: `npx playwright install-deps`)*

---

## 🔑 Step 2: Authentication (Generate `cookies.json`)

You have two easy ways to get your `cookies.json`:

### Option A: Use the Built-in Login Helper (Local Windows/Mac)
Run this command on your machine with a desktop:
```bash
npm run login
```
A Chrome window will pop up. Sign into your Google Account / YouTube channel. As soon as YouTube Studio loads, it will automatically save all cookies to `cookies.json` and close.

### Option B: Export from your existing Chrome browser
1. Install an extension like **"Cookie-Editor"** or **"EditThisCookie"** on Chrome/Brave.
2. Go to [https://studio.youtube.com](https://studio.youtube.com).
3. Click the extension -> **Export** -> **Export as JSON**.
4. Paste the content into a file named `cookies.json` inside this project directory.

---

## 📤 Step 3: Upload a Video

### Basic Upload (CLI)
```bash
npm run upload -- -f "path/to/video.mp4" -t "My Video Title"
```

### Full Upload with All Options
```bash
npm run upload -- \
  --file "path/to/video.mp4" \
  --title "How to Setup Linux VPS" \
  --description "In this video, we explore how to configure a fast VPS." \
  --tags "vps,linux,hosting,tutorial" \
  --thumbnail "path/to/thumbnail.jpg" \
  --visibility "public" \
  --cookies "cookies.json"
```

### Options Reference:

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-f, --file <path>` | Path to video file (`.mp4`, `.mov`, `.mkv`, etc.) | **Required** |
| `-t, --title <title>` | Title of the YouTube video | **Required** |
| `-d, --description <text>`| Video description | `""` |
| `--tags <tags>` | Comma-separated tags (e.g. `tag1,tag2`) | `""` |
| `--thumbnail <path>` | Path to image file (`.png`, `.jpg`) | None |
| `-v, --visibility <type>` | `public`, `unlisted`, or `private` | `unlisted` |
| `--kids` | Set audience to "Made for Kids" | `false` |
| `-c, --cookies <path>` | Path to your `cookies.json` file | `cookies.json` |
| `--headful` | Show browser window (for debugging) | `false` (headless) |

---

## 💻 Programmatic Usage (Node.js / TypeScript)

You can also import and use it in your own backend scripts or cron jobs:

```typescript
import { YouTubeUploader } from './src/uploader.js';

const uploader = new YouTubeUploader({
  cookiesPath: './cookies.json',
  headless: true,
});

const result = await uploader.upload({
  videoPath: './my_video.mp4',
  title: 'Automated Upload Title',
  description: 'Uploaded via VPS automated script',
  tags: ['automation', 'playwright'],
  visibility: 'unlisted',
});

console.log('Video Link:', result.videoUrl);
```

---

## 🐧 Deploying on a Linux VPS

1. Push this project or clone it on your VPS.
2. Transfer your `cookies.json` to the VPS (e.g. `scp cookies.json user@your-vps-ip:/path/to/youtube-studio-uploader/`).
3. Run:
   ```bash
   sudo apt-get update
   sudo apt-get install -y nodejs npm
   npm install
   npx playwright install-deps
   npx playwright install chromium
   ```
4. Upload directly:
   ```bash
   npm run upload -- -f "/var/videos/output.mp4" -t "VPS Uploaded Video"
   ```
