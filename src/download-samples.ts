import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const SAMPLE_DIR = path.resolve(process.cwd(), 'sample-videos');

if (!fs.existsSync(SAMPLE_DIR)) {
  fs.mkdirSync(SAMPLE_DIR, { recursive: true });
}

// 5 lightweight public domain sample video clips
const SAMPLES = [
  {
    name: 'sample_01_for_bigger_blazes.mp4',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  },
  {
    name: 'sample_02_for_bigger_escapes.mp4',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  },
  {
    name: 'sample_03_for_bigger_fun.mp4',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  },
  {
    name: 'sample_04_for_bigger_joyrides.mp4',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  },
  {
    name: 'sample_05_for_bigger_meltdowns.mp4',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
  },
];

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      console.log(`⏩ [EXISTS] ${path.basename(destPath)}`);
      return resolve();
    }

    const file = fs.createWriteStream(destPath);
    console.log(`⬇️  Downloading: ${path.basename(destPath)}...`);

    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`✅ [DOWNLOADED] ${path.basename(destPath)}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('===========================================================');
  console.log(`📥 Downloading 5 Sample Test Videos to: ${SAMPLE_DIR}`);
  console.log('===========================================================\n');

  for (const sample of SAMPLES) {
    const dest = path.join(SAMPLE_DIR, sample.name);
    try {
      await downloadFile(sample.url, dest);
    } catch (e: any) {
      console.error(`❌ Failed downloading ${sample.name}: ${e.message}`);
    }
  }

  console.log('\n===========================================================');
  console.log(`🎉 5 Sample videos ready in: ${SAMPLE_DIR}`);
  console.log(`👉 You can batch upload them with:`);
  console.log(`   sudo -u ytuploader npm run batch -- --dir "${SAMPLE_DIR}" --visibility "unlisted"`);
  console.log('===========================================================\n');
}

main().catch(console.error);
