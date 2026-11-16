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

// AudioWorklet modules are loaded at runtime and are not covered by HTML src/href checks.
for (const file of walk('.').filter(f => f.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of source.matchAll(/\bimport\s+(?:[^'\"]+?\s+from\s+)?['\"](\.\.?\/[^'\"]+)['\"]/g)) {
    const target = path.resolve(path.dirname(path.join(ROOT, file)), match[1]);
    if (!fs.existsSync(target)) issues.push(`${file}: missing local module import ${match[1]}`);
  }
}
if (!exists('src/frontend/truePeakLimiter.worklet.js') || !exists('src/frontend/truePeakLimiterCore.js')) {
  issues.push('True Peak Limiter AudioWorklet module or DSP core is missing');
}

// Security regression checks for the local HTTP boundary and renderer sinks.
const serverSource = fs.readFileSync(path.join(ROOT, 'src/backend/server.js'), 'utf8');
const pluginRoutesSource = fs.readFileSync(path.join(ROOT, 'src/backend/pluginRoutes.js'), 'utf8');
const securitySource = fs.readFileSync(path.join(ROOT, 'src/backend/securityUtils.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(ROOT, 'src/frontend/app.js'), 'utf8');
if (/\bfetch\s*\(/.test(serverSource)) issues.push('server.js contains a direct fetch call; use DNS-pinned fetchSafeUrl');
if (/\bfetch\s*\(/.test(pluginRoutesSource)) issues.push('pluginRoutes.js contains a direct fetch call; use DNS-pinned fetchSafeUrl');
for (const file of walk('src/backend').filter(f => f.endsWith('.js'))) {
  if (/\bfetch\s*\(/.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
    issues.push(`${file}: direct fetch bypasses DNS-pinned URL validation`);
  }
}
if (!securitySource.includes('createPinnedLookup') || !securitySource.includes('isLocalAddress(entry.address)')) {
  issues.push('SSRF guard must reject private DNS answers and pin the validated address');
}
if (!rendererSource.includes('messageNode.textContent')) {
  issues.push('showNotification must render untrusted messages using textContent');
}
for (const [file, required] of [
  ['src/backend/cueParser.js', 'resolveExistingFile'],
  ['src/backend/bpmDetector.js', 'resolveExistingFile'],
  ['src/backend/pluginManager.js', 'resolveSafePath'],
  ['src/backend/playlistExporter.js', 'resolveExistingFile']
]) {
  if (!fs.readFileSync(path.join(ROOT, file), 'utf8').includes(required)) {
    issues.push(`${file}: expected canonical path validation helper is missing`);
  }
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
const markdownExclusions = packageJson.build?.files || [];
if (!markdownExclusions.includes('!README.md') || !markdownExclusions.includes('!**/*.md') || !markdownExclusions.includes('!**/*.markdown')) {
  issues.push('build.files must exclude Markdown documentation from packaged application files');
}
if (!markdownExclusions.includes('!**/*.test.js') || !markdownExclusions.includes('!**/*.spec.js')) {
  issues.push('build.files must exclude automated test files from packaged application files');
}
if (fs.existsSync(path.join(ROOT, 'src/frontend/additional.css')) || fs.readFileSync(path.join(ROOT, 'src/frontend/index.html'), 'utf8').includes('additional.css')) issues.push('index.html still references removed additional.css');

if (issues.length) {
  console.error('KORAI static audit: FAILED');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}
console.log('KORAI static audit: PASSED');
