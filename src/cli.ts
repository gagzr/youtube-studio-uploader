import { Command } from 'commander';
import { YouTubeUploader, type UploadOptions } from './uploader.js';
import path from 'node:path';

const program = new Command();

program
  .name('yt-upload')
  .description('Upload videos to YouTube Studio headlessly using Playwright on VPS/Local')
  .version('1.0.0')
  .requiredOption('-f, --file <path>', 'Path to video file (.mp4, .mkv, .mov, etc.)')
  .requiredOption('-t, --title <title>', 'Video title')
  .option('-d, --description <desc>', 'Video description', '')
  .option('--tags <tags>', 'Comma-separated tags (e.g. "tech,vps,coding")', '')
  .option('--thumbnail <path>', 'Path to custom thumbnail image')
  .option('-v, --visibility <type>', 'Visibility (public, unlisted, private)', 'unlisted')
  .option('--kids', 'Mark video as Made for Kids', false)
  .option('-c, --cookies <path>', 'Path to cookies.json file', 'cookies.json')
  .option('--headful', 'Run browser in visible mode (default is headless)', false)
  .action(async (options) => {
    try {
      const tags = options.tags ? options.tags.split(',').map((s: string) => s.trim()) : [];
      const visibility = (['public', 'unlisted', 'private'].includes(options.visibility.toLowerCase())
        ? options.visibility.toLowerCase()
        : 'unlisted') as UploadOptions['visibility'];

      const uploader = new YouTubeUploader({
        cookiesPath: path.resolve(process.cwd(), options.cookies),
        headless: !options.headful,
      });

      console.log('----------------------------------------------------');
      console.log(`Starting Upload: ${options.file}`);
      console.log(`Title:           ${options.title}`);
      console.log(`Visibility:      ${visibility}`);
      console.log('----------------------------------------------------');

      const result = await uploader.upload({
        videoPath: options.file,
        title: options.title,
        description: options.description,
        tags,
        thumbnailPath: options.thumbnail,
        visibility,
        isMadeForKids: options.kids,
      });

      if (result.videoUrl) {
        console.log(`\n🔗 View your video at: ${result.videoUrl}`);
      }
      process.exit(0);
    } catch (error: any) {
      console.error(`\n❌ Upload Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
