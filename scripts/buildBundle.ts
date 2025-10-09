import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ENTRY = 'index.tsx';
const ASSETS_DIR = 'assets';
const METADATA_PATH = 'metadata.json';

async function ensureBundle() {
  const result = await build({
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
  });

  const jsOutput = result.outputFiles.find(file => file.path.endsWith('.js'));
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

ensureBundle()
  .then(newBundle => {
    console.log(`Bundle written to ${newBundle}`);
  })
  .catch(error => {
    console.error('Failed to build bundle:', error);
    process.exitCode = 1;
  });
