import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
if (output !== resolve(root, 'dist')) throw new Error('Unexpected output directory');
for (const file of ['src/app.js', 'src/board.js', 'src/engine.js', 'src/bot.js', 'src/board-view.js']) {
  const check = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(check.stderr);
}
await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'src'), resolve(output, 'src'), { recursive: true });
await writeFile(resolve(output, 'index.html'), await readFile(resolve(root, 'index.html')));
console.log('Build complete: dist/ (static site, no runtime dependencies).');
