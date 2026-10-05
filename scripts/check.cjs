'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {assemble} = require('./build.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const json = file => JSON.parse(read(file));
const normalized = value => value.trimEnd() + '\n';
const semver = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);

function metadata() {
  const manifest = json('manifest.json');
  const versions = json('versions.json');
  const pkg = json('package.json');
  const lock = json('package-lock.json');
  for (const name of ['id','name','version','minAppVersion','description','author']) {
    assert.equal(typeof manifest[name], 'string', 'Manifest ' + name + ' must be a string.');
    assert.ok(manifest[name].trim(), 'Manifest ' + name + ' must not be empty.');
  }
  assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/);
  assert.ok(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'));
  assert.match(manifest.name, /^[A-Za-z0-9 ()+-]+$/);
  assert.ok(!/obsidian|plugin/i.test(manifest.name));
  assert.ok(semver(manifest.version) && semver(manifest.minAppVersion));
  assert.equal(manifest.isDesktopOnly, true);
  assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
  assert.equal(pkg.name, manifest.id);
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.equal(pkg.license, 'MIT');
  assert.ok(!manifest.fundingUrl, 'Unused fundingUrl should be omitted.');
  assert.ok(read('LICENSE').includes('MIT License'));
  assert.ok(!fs.existsSync(path.join(root, 'data.json')), 'Do not include personal plugin settings.');
  for (const file of ['README.md','styles.css','docs/usage.md','docs/development.md','docs/compatibility.md','docs/releasing.md']) {
    assert.ok(read(file).trim(), 'Required project file is empty: ' + file);
  }
  console.log('PASS release metadata and required documents');
}

function source() {
  const files = ['src/main.js','src/native-reader-bridge.js','src/native-underline-interaction.js','src/create-literature-cards.js','src/local-book-store.js','src/local-reader-surface.js','src/local-publisher-typography.js','src/local-books-integration.js','main.js','tests/local-reader-continuous-browser.js','tests/local-reader-continuous-edges-browser.js','tests/local-reader-startup-browser.js','tests/local-reader-indent-browser.js','tests/local-reader-publisher-browser.js','tests/local-reader-navigation-browser.js'];
  for (const file of files) {
    const value = read(file);
    new vm.Script(value, {filename:file});
    assert.ok(!/[CD]:[\\/]Users[\\/]/i.test(value), 'Personal absolute path in ' + file);
    assert.ok(!/wrk-[A-Za-z0-9]{12,}/.test(value), 'Possible API secret in ' + file);
  }
  const expected = assemble();
  assert.equal(read('src/local-reader-surface.js'), normalized(expected.reader), 'Publisher typography is out of date; run npm run build.');
  assert.equal(read('src/native-reader-bridge.js'), normalized(expected.bridge), 'Bridge is out of date; run npm run build.');
  assert.equal(read('src/main.js'), normalized(expected.main), 'Embedded source is out of date; run npm run build.');
  assert.equal(read('main.js'), normalized(expected.main), 'Generated main.js is out of date; run npm run build.');
  assert.equal(read('styles.css'), normalized(expected.styles), 'Local reader CSS is out of date; run npm run build.');
  console.log('PASS source syntax, embedding consistency, and basic private-data checks');
}

function regressions() {
  const directory = path.join(root, 'tests');
  const files = fs.readdirSync(directory).filter(file => /^validate-.+\.cjs$/.test(file)).sort();
  assert.ok(files.length > 0, 'No local regression scripts found.');
  for (const file of files) {
    const result = spawnSync(process.execPath, [path.join(directory, file)], {
      cwd:root, encoding:'utf8', timeout:120000, maxBuffer:2 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw new Error(file + ': ' + result.error.message);
    assert.equal(result.status, 0, file + ' failed.');
  }
  console.log('PASS ' + files.length + ' regression suites');
}

try {
  metadata();
  source();
  regressions();
  console.log('Local checks passed. This does not certify private APIs or community review approval.');
} catch (error) {
  console.error('Check failed: ' + error.message);
  process.exitCode = 1;
}
