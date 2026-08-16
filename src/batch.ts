import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { YouTubeUploader, type UploadOptions } from './uploader.js';

interface BatchItem {
  file: string;
  title?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  isMadeForKids?: boolean;
}

interface BatchRecord {
  file: string;
  title: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  videoUrl?: string;
  videoId?: string;
  error?: string;
  completedAt?: string;
}

const SUPPORTED_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v'];

async function runBatch() {
  const program = new Command();

  program
    .name('youtube-batch-uploader')
    .description('Batch upload videos to YouTube Studio with persistent CDP session')
    .option('-m, --manifest <path>', 'Path to JSON manifest file containing list of videos')
    .option('-d, --dir <path>', 'Directory containing video files to upload')
    .option('-v, --visibility <type>', 'Default visibility (public, unlisted, private)', 'unlisted')
    .option('--delay <seconds>', 'Delay between consecutive uploads in seconds', '15')
    .option('--history <path>', 'Path to save batch execution history', 'batch-history.json')
    .parse(process.argv);

  const opts = program.opts();

  let queue: BatchItem[] = [];

  // Mode 1: Manifest JSON
  if (opts.manifest) {
    const manifestPath = path.resolve(opts.manifest);
    if (!fs.existsSync(manifestPath)) {
      console.error(`❌ Manifest file not found: ${manifestPath}`);
      process.exit(1);
    }
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      queue = JSON.parse(raw);
      console.log(`[+] Loaded ${queue.length} video tasks from manifest: ${manifestPath}`);
    } catch (e: any) {
      console.error(`❌ Failed to parse JSON manifest: ${e.message}`);
      process.exit(1);
    }
  }
  // Mode 2: Scan Directory
  else if (opts.dir) {
    const targetDir = path.resolve(opts.dir);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      console.error(`❌ Directory does not exist: ${targetDir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(targetDir);
    const videoFiles = files.filter(f => SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase()));

    if (videoFiles.length === 0) {
      console.log(`[!] No video files found in ${targetDir} with extensions: ${SUPPORTED_EXTENSIONS.join(', ')}`);
      process.exit(0);
    }

    queue = videoFiles.map(filename => {
      const fullPath = path.join(targetDir, filename);
      const cleanTitle = path.basename(filename, path.extname(filename))
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());

      return {
        file: fullPath,
        title: cleanTitle,
        visibility: opts.visibility,
      };
    });

    console.log(`[+] Discovered ${queue.length} video files in: ${targetDir}`);
  } else {
    console.error('❌ Please specify either --manifest <path> or --dir <path>');
    program.help();
    process.exit(1);
  }

  // Load existing history to support resuming without re-uploading
  const historyPath = path.resolve(opts.history);
  let history: Record<string, BatchRecord> = {};
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch {}
  }

  const uploader = new YouTubeUploader();
  const delaySec = parseInt(opts.delay, 10) || 15;

  console.log('\n===========================================================');
  console.log(`🚀 Starting Batch Upload: ${queue.length} Total Items`);
  console.log(`⏱️  Inter-video cooldown: ${delaySec}s`);
  console.log(`📝 History tracking file: ${historyPath}`);
  console.log('===========================================================\n');

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const absPath = path.resolve(item.file);
    const videoTitle = item.title || path.basename(absPath, path.extname(absPath));

    console.log(`\n-----------------------------------------------------------`);
    console.log(`[Task ${i + 1}/${queue.length}] Processing: "${videoTitle}"`);
    console.log(`File: ${absPath}`);
    console.log(`-----------------------------------------------------------`);

    // Check if already succeeded in previous run
    if (history[absPath] && history[absPath].status === 'SUCCESS') {
      console.log(`⏩ [SKIPPED] Already uploaded successfully!`);
      if (history[absPath].videoUrl) {
        console.log(`👉 Video URL: ${history[absPath].videoUrl}`);
      } else {
        console.log(`👉 Video URL was not captured. Check YouTube Studio manually.`);
      }
      skippedCount++;
      continue;
    }

    const uploadOptions: UploadOptions = {
      videoPath: absPath,
      title: videoTitle,
      description: item.description,
      tags: item.tags,
      thumbnailPath: item.thumbnail,
      visibility: item.visibility || opts.visibility || 'unlisted',
      isMadeForKids: item.isMadeForKids ?? false,
    };

    try {
      const res = await uploader.upload(uploadOptions);
      history[absPath] = {
        file: absPath,
        title: videoTitle,
        status: 'SUCCESS',
        videoUrl: res.videoUrl,
        videoId: res.videoId,
        completedAt: new Date().toISOString(),
      };
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
      successCount++;

      console.log(`✅ [Task ${i + 1}/${queue.length} COMPLETED] "${videoTitle}"`);
      if (res.videoUrl) {
        console.log(`🔗 ${res.videoUrl}`);
      }

      // Inter-upload cooldown delay (if not last item)
      if (i < queue.length - 1) {
        console.log(`⏳ Cooling down for ${delaySec}s before next video...`);
        await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
      }
    } catch (err: any) {
      failCount++;
      history[absPath] = {
        file: absPath,
        title: videoTitle,
        status: 'FAILED',
        error: err.message,
        completedAt: new Date().toISOString(),
      };
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
      console.error(`❌ [Task ${i + 1}/${queue.length} FAILED] "${videoTitle}": ${err.message}`);
    }
  }

  console.log('\n===========================================================');
  console.log('🎉 Batch Processing Complete!');
  console.log(`✅ Succeeded: ${successCount}`);
  console.log(`⏩ Skipped:   ${skippedCount}`);
  console.log(`❌ Failed:    ${failCount}`);
  console.log(`📋 Full report written to: ${historyPath}`);
  console.log('===========================================================');

  if (successCount > 0 || skippedCount > 0) {
    console.log('\n📺 Uploaded Videos Summary:');
    console.log('-----------------------------------------------------------');
    for (const [filePath, record] of Object.entries(history)) {
      if (record.status === 'SUCCESS') {
        console.log(`🎬 Title: ${record.title}`);
        console.log(`🔗 URL:   ${record.videoUrl || 'https://studio.youtube.com'}`);
        console.log(`📁 File:  ${filePath}`);
        console.log('-----------------------------------------------------------');
      }
    }
  }
  console.log('\n');
}

runBatch().catch(err => {
  console.error('Fatal batch error:', err);
  process.exit(1);
});
