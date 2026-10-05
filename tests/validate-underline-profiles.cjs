'use strict';

const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context = {
  require:name => {
    assert.equal(name, 'obsidian', 'A ready local bridge cannot invoke an external runtime');
    return {Plugin:class {}, PluginSettingTab:class {}, Notice:class {}};
  },
  URL, module:{exports:{}}, setTimeout, clearTimeout,
  document:{body:{}}, getComputedStyle:()=>({fontFamily:'"Segoe UI", sans-serif'})
};
vm.runInNewContext(fs.readFileSync(__dirname + '/../main.js', 'utf8'), context);
const Pocket = context.module.exports;
const {normalizedUnderlineProfiles, normalizedLiteratureLocations, normalizedLayoutProfiles, normalizedCardProfiles} = Pocket._test;
const locations = ['floating', 'dock', 'sidebar', 'tab'], modes = ['reading', 'card'];
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
function setLocation(p, key) {
  p.expanded = key === 'sidebar' || key === 'tab';
  if(!p.expanded) p.settings.dockPocket = key === 'dock';
  p.readerLeaf = p.expanded ? {getRoot:()=>key === 'sidebar' ? p.app.workspace.rightSplit : p.tabRoot} : null;
  assert.equal(p.layoutProfileKey(), key);
}
function pocket(saved = {}) {
  const p = new Pocket();
  p.settings = {
    dockPocket:true, showPopularUnderlines:true, readingFlow:'paged',
    literatureDisguise:false, literatureLocations:normalizedLiteratureLocations({}),
    literatureEnglish:'', literatureParagraphs:3, literatureTitle:'Research cards',
    underlineProfiles:normalizedUnderlineProfiles({}),
    layoutProfiles:normalizedLayoutProfiles({fontSizePx:14, lineHeight:1.9, contentPadding:64, miniContentPadding:16}),
    cardLayoutProfiles:normalizedCardProfiles({}), ...plain(saved)
  };
  p.app = {workspace:{rightSplit:{}}}; p.tabRoot = {};
  p.saved = []; p.applied = [];
  p.persist = () => p.saved.push(plain(p.settings));
  p.applyAppearance = async () => p.applied.push({location:p.layoutProfileKey(), mode:p.underlineProfileMode(), enabled:p.isPopularUnderlinesEnabled()});
  p.setReadingFlow = () => assert.fail('Underline preferences cannot switch reading flow');
  setLocation(p, 'dock'); p.activateLayoutProfile();
  return p;
}

// Preserve the legacy user choice everywhere, but give explicit stored booleans priority.
for(const legacy of [false, true, undefined]) {
  const input = Object.freeze({showPopularUnderlines:legacy});
  const expected = Object.fromEntries(modes.map(mode => [mode, Object.fromEntries(locations.map(key => [key, legacy !== false]))]));
  assert.deepEqual(plain(normalizedUnderlineProfiles(input)), expected);
  assert.equal(Object.hasOwn(input, 'underlineProfiles'), false);
}
const partial = {
  showPopularUnderlines:false,
  underlineProfiles:{reading:{floating:true, dock:false, sidebar:null, tab:'true'}, card:{floating:false, sidebar:true, unknown:true}}
};
const beforePartial = JSON.stringify(partial);
assert.deepEqual(plain(normalizedUnderlineProfiles(partial)), {
  reading:{floating:true, dock:false, sidebar:false, tab:false},
  card:{floating:false, dock:false, sidebar:true, tab:false}
});
assert.equal(JSON.stringify(partial), beforePartial, 'Normalization cannot change the saved migration input');
assert.deepEqual(plain(normalizedUnderlineProfiles({showPopularUnderlines:true, underlineProfiles:{reading:{floating:false}, card:{dock:false}}})), {
  reading:{floating:false, dock:true, sidebar:true, tab:true},
  card:{floating:true, dock:false, sidebar:true, tab:true}
});
for(const malformed of [null, false, [], 7]) {
  assert.deepEqual(plain(normalizedUnderlineProfiles({showPopularUnderlines:false, underlineProfiles:malformed})), {
    reading:{floating:false, dock:false, sidebar:false, tab:false}, card:{floating:false, dock:false, sidebar:false, tab:false}
  });
}
const fallback = pocket(); delete fallback.settings.underlineProfiles;
for(const legacy of [false, true]) {
  fallback.settings.showPopularUnderlines = legacy;
  const before = JSON.stringify(fallback.settings);
  for(const key of locations) for(const mode of modes) assert.equal(fallback.isPopularUnderlinesEnabled(key, mode), legacy);
  assert.equal(JSON.stringify(fallback.settings), before, 'Reading a fallback cannot initialize or edit preferences');
}

(async () => {
  const split = pocket({
    literatureLocations:{floating:true, dock:false, sidebar:true, tab:false},
    underlineProfiles:{reading:{floating:true, dock:false, sidebar:true, tab:false}, card:{floating:false, dock:true, sidebar:false, tab:true}}
  });
  for(const key of locations) {
    for(const mode of modes) assert.equal(split.isPopularUnderlinesEnabled(key, mode), split.settings.underlineProfiles[mode][key]);
    const selectedMode = split.settings.literatureLocations[key] ? 'card' : 'reading';
    assert.equal(split.isPopularUnderlinesEnabled(key), split.settings.underlineProfiles[selectedMode][key], 'Another position uses its own card preference');
    setLocation(split, key); split.activateLayoutProfile();
    assert.equal(split.isPopularUnderlinesEnabled(), split.settings.underlineProfiles[selectedMode][key]);
  }

  // An inactive position or mode edit saves one flag without contacting or moving the live guest.
  const inactive = pocket(); inactive.ready = true;
  const guest = inactive.webview = {executeJavaScript:()=>assert.fail('An inactive preference cannot contact the live guest')};
  const initialLayout = JSON.stringify([inactive.settings.layoutProfiles, inactive.settings.cardLayoutProfiles]);
  const initialMode = JSON.stringify(inactive.settings.literatureLocations);
  const initialFont = inactive.settings.fontSizePx;
  for(const name of ['show', 'hide', 'openReaderTab', 'openReaderSidebar', 'collapseToPocket', 'setPocketDock', 'mountWebview']) {
    inactive[name] = () => assert.fail('A preference edit cannot move or remount the guest');
  }
  const expected = plain(inactive.settings.underlineProfiles);
  for(const [key, mode] of [['floating','reading'], ['sidebar','card'], ['dock','card'], ['tab','reading']]) {
    expected[mode][key] = false;
    assert.equal(await inactive.setPopularUnderlines(false, key, mode), true);
    assert.deepEqual(plain(inactive.settings.underlineProfiles), expected, 'Each inactive edit changes only its selected flag');
  }
  assert.deepEqual(inactive.applied, []);
  assert.equal(inactive.layoutProfileKey(), 'dock');
  assert.equal(inactive.webview, guest);
  assert.equal(inactive.settings.readingFlow, 'paged');
  assert.equal(inactive.settings.fontSizePx, initialFont);
  assert.equal(JSON.stringify([inactive.settings.layoutProfiles, inactive.settings.cardLayoutProfiles]), initialLayout);
  assert.equal(JSON.stringify(inactive.settings.literatureLocations), initialMode);
  assert.equal(inactive.settings.showPopularUnderlines, true, 'Independent edits retain the migration fallback');
  const reloaded = pocket(inactive.saved.at(-1));
  reloaded.settings.underlineProfiles = normalizedUnderlineProfiles(reloaded.settings);
  assert.deepEqual(plain(reloaded.settings.underlineProfiles), expected);
  for(const key of locations) for(const mode of modes) assert.equal(reloaded.isPopularUnderlinesEnabled(key, mode), expected[mode][key]);

  // A current edit is immediately reflected; toggling cards restores a separate saved choice.
  const active = pocket(); active.ready = true;
  assert.equal(await active.setPopularUnderlines(false), true);
  assert.deepEqual(active.applied, [{location:'dock', mode:'reading', enabled:false}]);
  active.settings.literatureLocations.dock = true; active.activateLayoutProfile();
  assert.equal(active.isPopularUnderlinesEnabled(), true);
  assert.equal(await active.setPopularUnderlines(false), true);
  assert.deepEqual(active.applied.at(-1), {location:'dock', mode:'card', enabled:false});
  assert.equal(await active.setPopularUnderlines(true, 'dock', 'reading'), true);
  assert.equal(active.applied.length, 2, 'Editing ordinary reading while cards are active cannot redraw the current cards');
  assert.equal(active.isPopularUnderlinesEnabled(), false);
  active.settings.literatureLocations.dock = false; active.activateLayoutProfile();
  assert.equal(active.isPopularUnderlinesEnabled(), true);
  assert.equal(active.settings.readingFlow, 'paged');

  // Saving before a book opens still persists the choice without requiring a native bridge.
  const unopened = pocket(); unopened.ready = false;
  assert.equal(await unopened.setPopularUnderlines(false, 'sidebar', 'card'), true);
  assert.equal(unopened.saved.at(-1).underlineProfiles.card.sidebar, false);
  assert.equal(unopened.settings.readingFlow, 'paged');
  const unloaded = pocket(); unloaded.unloaded = true;
  const unloadedBefore = JSON.stringify(unloaded.settings);
  assert.equal(await unloaded.setPopularUnderlines(false), false);
  assert.equal(JSON.stringify(unloaded.settings), unloadedBefore);
  assert.equal(unloaded.saved.length, 0);

  // Evaluate the actual guest request, not a source-string proxy, in all eight contexts.
  const native = pocket(); native.ready = true;
  native.appearanceEpoch = 11; native.appearanceRevision = 7;
  native.navigationRevision = 4; native.appearanceGeneration = 3;
  native.resolvedTheme = () => 'dark';
  const calls = [];
  native.webview = {executeJavaScript:async script => vm.runInNewContext(script, {
    document:{getElementById:()=>({dataset:{wrpEpoch:11, wrpRevision:7}}), querySelector:()=>({})},
    window:{__wrpSetLiteratureAppearance:()=>{}, __wrpApplyNativePadding:(...args)=>{calls.push(args); return true;}, __wrpApplyNativeTheme:async()=>{}}
  })};
  for(const mode of modes) for(const [index, key] of locations.entries()) {
    setLocation(native, key);
    native.settings.literatureLocations[key] = mode === 'card';
    native.settings.underlineProfiles[mode][key] = (index % 2 === 0) === (mode === 'reading');
    native.activateLayoutProfile();
    assert.equal(await native.resolveNativeReaderPadding(), true);
    const last = calls.at(-1);
    assert.equal(last[2], native.settings.underlineProfiles[mode][key], 'The native renderer receives the current mode and position flag');
    assert.equal(last[1], key === 'floating' || key === 'dock');
    assert(last[6].startsWith(mode + ':' + key + ':'));
  }

  // A late response from the previous document generation cannot trigger bridge discovery.
  const late = deferred();
  native.webview.executeJavaScript = () => late.promise;
  const pending = native.resolveNativeReaderPadding();
  setLocation(native, 'floating'); native.activateLayoutProfile(); native.appearanceGeneration++;
  late.resolve(false);
  assert.equal(await pending, false);

  // A queued redraw reads the newest position and mode, including its independent flag.
  const queued = pocket(); queued.ready = true; queued.settings.readingFlow = 'scroll';
  queued.settings.hideBottomBar = false; queued.settings.zoom = 0.9;
  queued.settings.underlineProfiles.reading.dock = false;
  queued.settings.underlineProfiles.card.sidebar = true;
  queued.settings.literatureLocations.sidebar = true;
  queued.navigationRevision = 1; queued.appearanceGeneration = 1; queued.appearanceEpoch = 2;
  queued.updateFontButtons = () => {}; queued.updateHostTheme = () => {};
  queued.setAppearancePending = () => {}; queued.readingPalette = () => ({theme:'dark'});
  queued.refreshReaderHeader = async () => {};
  const rendered = [];
  queued.refreshReaderLayout = async () => rendered.push({location:queued.layoutProfileKey(), mode:queued.underlineProfileMode(), enabled:queued.isPopularUnderlinesEnabled()});
  queued.webview = {setZoomFactor:()=>{}, executeJavaScript:async()=>({epoch:queued.appearanceEpoch, revision:queued.appearanceRevision, applied:true, bottomHidden:true})};
  const previous = deferred(); queued.appearanceTask = previous.promise;
  const oldRequest = Pocket.prototype.applyAppearance.call(queued);
  setLocation(queued, 'sidebar'); queued.activateLayoutProfile();
  const newestRequest = Pocket.prototype.applyAppearance.call(queued);
  previous.resolve(); await oldRequest; await newestRequest;
  assert.deepEqual(rendered, [{location:'sidebar', mode:'card', enabled:true}], 'A displaced queued edit cannot apply the previous location flag');

  console.log('PASS: underline migration, eight independent mode/location preferences, saved reload, inactive/no-book edits, current redraw, native bridge flags and delayed document/appearance guards.');
})().catch(error => {console.error(error); process.exitCode = 1;});
