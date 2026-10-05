const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const issues = [];
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');

function exists(p) { return fs.existsSync(path.join(ROOT, p)); }
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(child)); else out.push(child);
  }
  return out;
}

for (const file of walk('src/frontend').filter(f => f.endsWith('.html'))) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const refs = [...text.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const ref of refs) {
    if (ref.includes('${')) continue;
    if (/^(https?:|data:|#|javascript:)/i.test(ref)) continue;
    const local = path.normalize(path.join(path.dirname(file), ref));
    if (!exists(local)) issues.push(`${file}: missing local asset ${ref}`);
  }
}

for (const file of walk('.').filter(f => f.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { encoding: 'utf8' });
  if (result.status !== 0) issues.push(`${file}: syntax check failed\n${result.stderr}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
if (packageJson.version !== lock.packages?.['']?.version) issues.push('package.json version and lockfile root version differ');
for (const dep of ['fluent-ffmpeg', 'node-fetch', 'wav']) {
  if (packageJson.dependencies?.[dep]) issues.push(`unused direct dependency remains: ${dep}`);
}
if (!exists('build/license.txt')) issues.push('build/license.txt is missing');
for (const forbidden of ['src/frontend/homeEnhancements.js', 'src/frontend/libraryMasonry.js', 'src/frontend/pluginStoreUI.js']) {
  if (exists(forbidden)) issues.push(`obsolete frontend file remains: ${forbidden}`);
}
for (const file of walk('.').filter(f => /\.(md|markdown)$/i.test(f))) {
  issues.push(`documentation file must not be shipped in final 1.6 package: ${file}`);
}
if (fs.existsSync(path.join(ROOT, 'src/frontend/additional.css')) || fs.readFileSync(path.join(ROOT, 'src/frontend/index.html'), 'utf8').includes('additional.css')) issues.push('index.html still references removed additional.css');

if (issues.length) {
  console.error('KORAI static audit: FAILED');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}
console.log('KORAI static audit: PASSED');
