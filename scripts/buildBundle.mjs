import { build, context } from 'esbuild';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ENTRY = 'index.tsx';
const ASSETS_DIR = 'assets';
const METADATA_PATH = 'metadata.json';

const BUILD_OPTIONS = {
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  tsconfig: 'tsconfig.json',
  logLevel: 'silent',
  outfile: 'index.js',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.API_KEY': 'undefined',
    'process.env.GEMINI_API_KEY': 'undefined'
  },
  write: false
};

async function writeBundleOutputs(result) {
  const outputFiles = result.outputFiles || [];
  const jsOutput = outputFiles.find(file => file.path.endsWith('.js'));
  if (!jsOutput) {
    throw new Error('Failed to locate JavaScript output from esbuild');
  }

  const hash = createHash('sha256').update(jsOutput.text).digest('base64url').slice(0, 8);
  const fileName = `index-${hash}.js`;
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const assetPath = path.join(ASSETS_DIR, fileName);
  await fs.writeFile(assetPath, jsOutput.text, 'utf8');

  const existing = JSON.parse(await fs.readFile(METADATA_PATH, 'utf8'));
  const updated = { ...existing, entryBundle: `${ASSETS_DIR}/${fileName}` };
  await fs.writeFile(METADATA_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');

  const assetFiles = await fs.readdir(ASSETS_DIR);
  await Promise.all(
    assetFiles
      .filter(name => /^index-[A-Za-z0-9_-]+\.js$/.test(name) && name !== fileName)
      .map(oldName => fs.unlink(path.join(ASSETS_DIR, oldName)).catch(() => {}))
  );

  return `${ASSETS_DIR}/${fileName}`;
}

async function buildOnce() {
  const result = await build(BUILD_OPTIONS);
  return writeBundleOutputs(result);
}

async function buildWithWatch() {
  const ctx = await context(BUILD_OPTIONS);
  const initialResult = await ctx.rebuild();
  const initialFile = await writeBundleOutputs(initialResult);
  console.log(`Bundle written to ${initialFile}`);

  await ctx.watch({
    async onRebuild(error, result) {
      if (error) {
        console.error('Bundle rebuild failed:', error);
        return;
      }
      if (!result) return;
      try {
        const file = await writeBundleOutputs(result);
        console.log(`Bundle rebuilt to ${file}`);
      } catch (writeError) {
        console.error('Failed to write rebuilt bundle:', writeError);
      }
    }
  });
  console.log('Watching for changes...');

  const dispose = () => {
    ctx.dispose().then(() => {
      console.log('Stopped bundle watcher.');
      process.exit(0);
    });
  };

  process.on('SIGINT', dispose);
  process.on('SIGTERM', dispose);
}

const watchMode = process.argv.includes('--watch');

(async () => {
  if (watchMode) {
    await buildWithWatch();
  } else {
    const bundlePath = await buildOnce();
    console.log(`Bundle written to ${bundlePath}`);
  }
})().catch(error => {
  if (error instanceof Error) {
    console.error('Failed to build bundle:', error.stack ?? error.message);
  } else {
    console.error('Failed to build bundle:', error);
  }
  process.exitCode = 1;
});
