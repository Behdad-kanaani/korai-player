#!/usr/bin/env node

/**
 * KORAI Plugin CLI Tool
 * 
 * Usage:
 *   korai-plugin create <name>     - Create new plugin from template
 *   korai-plugin pack <dir>        - Pack plugin directory to ZIP
 *   korai-plugin validate <dir>    - Validate plugin manifest
 *   korai-plugin dev <dir> [port]  - Start dev server with hot-reload
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const cmd = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

function log(msg, color = 'reset') {
  const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
  };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

function createPlugin(name) {
  if (!name) {
    log('❌ Plugin name required: korai-plugin create <name>', 'red');
    process.exit(1);
  }

  const pluginDir = path.join(process.cwd(), name);
  if (fs.existsSync(pluginDir)) {
    log(`❌ Directory already exists: ${pluginDir}`, 'red');
    process.exit(1);
  }

  fs.mkdirSync(pluginDir, { recursive: true });

  const manifest = {
    id: `com.korai.${name.toLowerCase()}`,
    name: name,
    version: '1.0.0',
    description: 'My awesome KORAI plugin',
    author: 'Your Name',
    license: 'MIT',
    entry: 'index.js',
    permissions: ['api:logging', 'api:events', 'api:storage'],
    hooks: ['onLoad', 'onUnload', 'onTrackPlay']
  };

  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  const indexTemplate = `/**
 * ${name} Plugin for KORAI Music Player
 */

class ${name}Plugin {
  constructor(context) {
    this.context = context;
    this.api = context.api;
  }

  async activate(context) {
    this.api.log(\`✓ ${name} plugin activated!\`);
    this.api.notify(\`${name} plugin is running!\`, { duration: 2000 });
  }

  async deactivate(context) {
    this.api.log(\`✗ ${name} plugin deactivated\`);
  }

  async onLoad() {
    this.api.log('Plugin loaded');
  }

  async onUnload() {
    this.api.log('Plugin unloaded');
  }

  async onTrackPlay(track) {
    this.api.log(\`Playing: \${track.title}\`);
  }
}

module.exports = ${name}Plugin;
`;

  fs.writeFileSync(path.join(pluginDir, 'index.js'), indexTemplate);

  const readme = `# ${name} Plugin

A plugin for KORAI Music Player.

## Installation

Pack the plugin:
\`\`\`
korai-plugin pack .
\`\`\`

Then install the ZIP in KORAI.

## Development

Start dev server with hot-reload:
\`\`\`
korai-plugin dev .
\`\`\`

## Hooks

- \`onLoad\` - Plugin loaded
- \`onUnload\` - Plugin unloaded  
- \`onTrackPlay(track)\` - Track started playing
- \`onTrackPause(track)\` - Track paused
- \`onAudioProcess(data)\` - Audio processing
- \`onBpmDetect(bpm)\` - BPM detected

## API

Available via \`this.api\`:
- \`api.log(msg)\` - Log message
- \`api.notify(msg, opts)\` - Show notification
- \`api.emit(event, data)\` - Emit event
- \`api.storage.get/set(key)\` - Persistent storage
`;

  fs.writeFileSync(path.join(pluginDir, 'README.md'), readme);

  fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({
    name: manifest.id,
    version: manifest.version,
    description: manifest.description,
    main: manifest.entry
  }, null, 2));

  log(`✓ Plugin created at ${pluginDir}`, 'green');
  log('', 'green');
  log('Next steps:', 'blue');
  log('  cd ' + name);
  log('  korai-plugin pack .    # Create plugin ZIP', 'yellow');
  log('  korai-plugin dev .     # Start development server', 'yellow');
}

function packPlugin(dir) {
  if (!dir || !fs.existsSync(dir)) {
    log(`❌ Plugin directory not found: ${dir}`, 'red');
    process.exit(1);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    log(`❌ manifest.json not found in ${dir}`, 'red');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const zipName = `${manifest.id}_v${manifest.version}.zip`;
  const zipPath = path.join(dir, '..', zipName);

  const zip = new AdmZip();
  const addDir = (dir, zipPath = '') => {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      if (file === 'node_modules' || file === '.git' || file.startsWith('.')) return;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        addDir(filePath, path.join(zipPath, file));
      } else {
        zip.addFile(path.join(zipPath, file), fs.readFileSync(filePath));
      }
    });
  };

  addDir(dir);
  zip.writeZip(zipPath);

  log(`✓ Plugin packed: ${zipPath}`, 'green');
  log(`  Name: ${manifest.name}`, 'blue');
  log(`  ID: ${manifest.id}`, 'blue');
  log(`  Version: ${manifest.version}`, 'blue');
}

function validatePlugin(dir) {
  if (!dir || !fs.existsSync(dir)) {
    log(`❌ Plugin directory not found: ${dir}`, 'red');
    process.exit(1);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    log(`❌ manifest.json not found`, 'red');
    process.exit(1);
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const required = ['id', 'name', 'version', 'entry'];
    for (const field of required) {
      if (!manifest[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    const entryPath = path.join(dir, manifest.entry);
    if (!fs.existsSync(entryPath)) {
      throw new Error(`Entry point not found: ${manifest.entry}`);
    }

    log(`✓ Plugin is valid`, 'green');
    log(`  ID: ${manifest.id}`, 'blue');
    log(`  Name: ${manifest.name}`, 'blue');
    log(`  Version: ${manifest.version}`, 'blue');
  } catch (err) {
    log(`❌ Validation failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

function devServer(dir, port = 3333) {
  if (!dir || !fs.existsSync(dir)) {
    log(`❌ Plugin directory not found: ${dir}`, 'red');
    process.exit(1);
  }

  log(`🚀 Starting dev server on port ${port}...`, 'green');
  log(`📂 Watching ${dir} for changes`, 'blue');
  
  // For now, just a placeholder
  log(`⚠️  Dev server with hot-reload coming soon!`, 'yellow');
  log(`📝 For now, test by manually packing and installing the plugin.`, 'yellow');
}

switch (cmd) {
  case 'create':
    createPlugin(arg1);
    break;
  case 'pack':
    packPlugin(arg1);
    break;
  case 'validate':
    validatePlugin(arg1);
    break;
  case 'dev':
    devServer(arg1, arg2);
    break;
  case '-h':
  case '--help':
  case 'help':
    log('KORAI Plugin CLI Tool', 'blue');
    log('');
    log('Usage:', 'yellow');
    log('  korai-plugin create <name>      - Create new plugin');
    log('  korai-plugin pack <dir>         - Pack plugin to ZIP');
    log('  korai-plugin validate <dir>     - Validate plugin manifest');
    log('  korai-plugin dev <dir> [port]   - Start dev server');
    break;
  default:
    log('❌ Unknown command: ' + cmd, 'red');
    log('Run: korai-plugin --help', 'yellow');
    process.exit(1);
}
