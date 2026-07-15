// build.mjs — bundles Lambda handlers into assets/*.zip
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, 'assets');
mkdirSync(assetsDir, { recursive: true });

async function bundle(name, entry) {
  const tmpDir = path.join(assetsDir, `_tmp_${name}`);
  mkdirSync(tmpDir, { recursive: true });
  await build({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: path.join(tmpDir, 'handler.js'),
    external: ['@aws-sdk/*'],
    minify: true,
  });
  const zipPath = path.join(assetsDir, `${name}.zip`);
  execSync(`cd "${tmpDir}" && zip -r "${zipPath}" .`);
  rmSync(tmpDir, { recursive: true });
  console.log(`✓ ${name}.zip`);
}

await bundle('presignup', 'src/lambdas/presignup/handler.ts');
await bundle('admin', 'src/lambdas/admin/handler.ts');
