'use strict';

const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const notices = [];
const requirePlugin = name => {
  assert.equal(name, 'obsidian');
  return {Plugin:class {}, PluginSettingTab:class {}, Notice:class {constructor(message) {notices.push(message);}}};
};
const context = {require:requirePlugin, URL, module:{exports:{}}, setTimeout, clearTimeout,
  document:{body:{}}, getComputedStyle:()=>({fontFamily:'"Segoe UI", sans-serif'})};
vm.runInNewContext(fs.readFileSync(__dirname + '/../main.js', 'utf8'), context);
const Pocket = context.module.exports;
const {normalizedLiteratureLocations, normalizedLayoutProfiles, normalizedCardProfiles} = Pocket._test;
const keys = ['floating', 'dock', 'sidebar', 'tab'];
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
function setLocation(p, key) {
  p.expanded = key === 'tab' || key === 'sidebar';
  if(!p.expanded) p.settings.dockPocket = key === 'dock';
  p.readerLeaf = p.expanded ? {getRoot:()=>key === 'sidebar' ? p.app.workspace.rightSplit : p.tabRoot} : null;
  assert.equal(p.layoutProfileKey(), key);
}
function pocket() {
  const p = new Pocket();
  p.settings = {
    dockPocket:true, literatureDisguise:false, literatureLocations:normalizedLiteratureLocations({}),
    literatureTitle:'Research cards', literatureEnglish:'', literatureParagraphs:3,
    readingFlow:'scroll', zoom:0.8, hideBottomBar:false,
    layoutProfiles:normalizedLayoutProfiles({fontSizePx:14, lineHeight:1.9, contentPadding:64, miniContentPadding:16}),
    cardLayoutProfiles:normalizedCardProfiles({})
  };
  [14, 16, 18, 24].forEach((size, index) => {p.settings.layoutProfiles[keys[index]].fontSizePx = size;});
  p.app = {workspace:{rightSplit:{}}};
  p.tabRoot = {};
  p.events = [];
  p.saved = [];
  p.persist = () => p.saved.push(plain(p.settings));
  p.updateLayoutControls = () => p.events.push('layout');
  p.updateFontButtons = () => {};
  p.updateShortcutHints = () => {p.events.push('title'); Pocket.prototype.updateShortcutHints.call(p);};
  p.applyAppearance = async () => {p.events.push('appearance');};
  setLocation(p, 'dock');
  p.activateLayoutProfile();
  return p;
}
function readyTypography(p) {
  let size = p.layoutProfile().fontSizePx;
  p.ready = true;
  p.navigationRevision = 1;
  p.appearanceGeneration = 1;
  p.syncNativeReaderPadding = async () => true;
  p.refreshFontControls = async () => ({
    level:1, size, lineHeight:p.layoutProfile().lineHeight,
    paragraphSpacing:p.layoutProfile().paragraphSpacing, ready:true,
    preferenceKey:p.typographyPreferenceKey()
  });
  p.webview = {executeJavaScript:async script => {
    const match = script.match(/window\.__wrpSetFontSize\((\d+)\)/);
    assert(match, 'The mock accepts only a native font-size edit');
    size = Number(match[1]);
    return true;
  }};
}

// A missing map inherits the legacy global flag; explicit booleans override it.
for(const legacy of [false, true]) {
  const settings = {literatureDisguise:legacy};
  assert.deepEqual(plain(normalizedLiteratureLocations(settings)), Object.fromEntries(keys.map(key => [key, legacy])));
  assert.equal(Object.hasOwn(settings, 'literatureLocations'), false, 'Normalization cannot mutate legacy settings');
}
assert.deepEqual(plain(normalizedLiteratureLocations({})), {floating:false, dock:false, sidebar:false, tab:false});
const partial = {literatureDisguise:true, literatureLocations:{floating:false, dock:0, tab:true, unknown:false}};
const partialBefore = JSON.stringify(partial);
assert.deepEqual(plain(normalizedLiteratureLocations(partial)), {floating:false, dock:true, sidebar:true, tab:true});
assert.equal(JSON.stringify(partial), partialBefore);
assert.deepEqual(plain(normalizedLiteratureLocations({literatureDisguise:false, literatureLocations:{sidebar:true, tab:false}})),
  {floating:false, dock:false, sidebar:true, tab:false});
const legacyPocket = pocket();
delete legacyPocket.settings.literatureLocations;
legacyPocket.settings.literatureDisguise = true;
const legacyBefore = JSON.stringify(legacyPocket.settings);
for(const key of keys) assert.equal(legacyPocket.isLiteratureEnabled(key), true);
assert.equal(JSON.stringify(legacyPocket.settings), legacyBefore, 'Reading a fallback flag cannot initialize or mutate settings');

(async () => {
  const profiles = pocket();
  profiles.settings.literatureLocations = {floating:true, dock:false, sidebar:true, tab:false};
  // Editing any chosen position must use that position's mode, even while dock is active.
  for(const key of keys) {
    const card = profiles.isLiteratureEnabled(key);
    assert.equal(profiles.layoutProfile(key), (card ? profiles.settings.cardLayoutProfiles : profiles.settings.layoutProfiles)[key]);
    assert.equal(profiles.defaultLayoutValue('font', key), card ? 12 : 21);
    assert.equal(profiles.defaultLayoutValue('line', key), card ? 1.3 : 1.9);
    assert.equal(profiles.defaultLayoutValue('paragraph', key), card ? 4 : 0);
    assert.equal(profiles.defaultLayoutValue('padding', key), card ? 12 : ['floating', 'dock'].includes(key) ? 16 : 64);
  }
  for(const key of keys) {
    setLocation(profiles, key);
    profiles.activateLayoutProfile();
    const card = profiles.isLiteratureEnabled(key);
    assert.equal(profiles.isLiteratureEnabled(), card);
    assert.equal(profiles.settings.fontSizePx, profiles.layoutProfile(key).fontSizePx);
    assert.equal(profiles.nativeFontSize, profiles.layoutProfile(key).fontSizePx);
    assert(profiles.typographyPreferenceKey().startsWith((card ? 'card:' : 'reading:') + key + ':'));
    assert.equal(profiles.literatureConfig().enabled, card);
  }

  const inactive = pocket();
  delete inactive.settings.literatureLocations;
  inactive.ready = true;
  inactive.settings.readingFlow = 'paged';
  const guest = inactive.webview = {executeJavaScript:()=>assert.fail('An inactive toggle cannot contact the guest')};
  const locationBefore = {expanded:inactive.expanded, dockPocket:inactive.settings.dockPocket, leaf:inactive.readerLeaf};
  const fontBefore = inactive.settings.fontSizePx;
  const ordinaryBefore = JSON.stringify(inactive.settings.layoutProfiles);
  inactive.setReadingFlow = () => assert.fail('An inactive toggle cannot switch reading flow');
  for(const method of ['show', 'hide', 'openReaderTab', 'openReaderSidebar', 'collapseToPocket', 'setPocketDock', 'mountWebview']) {
    inactive[method] = () => assert.fail('An inactive toggle cannot move or remount the reader');
  }
  assert.equal(await inactive.setLiteratureDisguise(true, 'tab'), true);
  assert.deepEqual(plain(inactive.settings.literatureLocations), {floating:false, dock:false, sidebar:false, tab:true});
  assert.equal(await inactive.setLiteratureDisguise(true, 'sidebar'), true);
  assert.equal(await inactive.setLiteratureDisguise(false, 'tab'), true);
  assert.deepEqual(plain(inactive.settings.literatureLocations), {floating:false, dock:false, sidebar:true, tab:false});
  assert.deepEqual(inactive.events, [], 'An inactive toggle cannot update current appearance, title or layout');
  assert.equal(inactive.settings.readingFlow, 'paged');
  assert.equal(inactive.settings.fontSizePx, fontBefore);
  assert.equal(JSON.stringify(inactive.settings.layoutProfiles), ordinaryBefore);
  assert.equal(inactive.expanded, locationBefore.expanded);
  assert.equal(inactive.settings.dockPocket, locationBefore.dockPocket);
  assert.equal(inactive.readerLeaf, locationBefore.leaf);
  assert.equal(inactive.webview, guest);
  assert.deepEqual(plain(normalizedLiteratureLocations(inactive.saved.at(-1))), plain(inactive.settings.literatureLocations));

  const active = pocket();
  active.ready = true;
  active.settings.readingFlow = 'paged';
  active.message = {setText:value => {active.title = value;}};
  active.setReadingFlow = async flow => {active.events.push('flow:' + flow); active.settings.readingFlow = flow; return true;};
  const otherFlags = keys.filter(key => key !== 'dock').map(key => active.settings.literatureLocations[key]);
  const ordinary = JSON.stringify(active.settings.layoutProfiles);
  const otherCardProfiles = JSON.stringify(keys.filter(key => key !== 'dock').map(key => active.settings.cardLayoutProfiles[key]));
  assert.equal(await active.setLiteratureDisguise(true), true);
  assert.equal(active.settings.readingFlow, 'scroll');
  assert.equal(active.settings.fontSizePx, 12);
  assert.equal(active.nativeFontSize, 12);
  assert(active.title.startsWith('Research cards'));
  assert(active.events.includes('flow:scroll'));
  assert(active.events.includes('layout') && active.events.includes('title') && active.events.includes('appearance'));
  readyTypography(active);
  assert.equal(await active.setFontSize(21), true);
  assert.equal(active.settings.cardLayoutProfiles.dock.fontSizePx, 21);
  assert.equal(JSON.stringify(keys.filter(key => key !== 'dock').map(key => active.settings.cardLayoutProfiles[key])), otherCardProfiles);
  assert.equal(JSON.stringify(active.settings.layoutProfiles), ordinary, 'Card typography cannot overwrite ordinary typography');
  assert.equal(await active.setLiteratureDisguise(false), true);
  assert.equal(active.settings.fontSizePx, 16);
  assert.equal(active.nativeFontSize, 16);
  assert(active.title.startsWith('阅读'));
  assert.deepEqual(keys.filter(key => key !== 'dock').map(key => active.settings.literatureLocations[key]), otherFlags);
  assert.equal(JSON.stringify(active.settings.layoutProfiles), ordinary);
  assert.equal(await active.setLiteratureDisguise(true), true);
  assert.equal(active.settings.fontSizePx, 21, 'Returning to card mode restores its saved font');

  const unopened = pocket();
  unopened.settings.readingFlow = 'paged';
  unopened.setReadingFlow = () => assert.fail('Saving a preference without a ready book cannot initiate a native flow change');
  assert.equal(await unopened.setLiteratureDisguise(true), true);
  assert.equal(unopened.settings.readingFlow, 'paged');
  assert.equal(unopened.isLiteratureEnabled(), true);

  const changingLocation = pocket();
  changingLocation.ready = true;
  changingLocation.settings.readingFlow = 'paged';
  const switchFlow = deferred();
  changingLocation.setReadingFlow = () => switchFlow.promise;
  const pendingToggle = changingLocation.setLiteratureDisguise(true, 'dock');
  setLocation(changingLocation, 'tab');
  changingLocation.activateLayoutProfile();
  const tabFont = changingLocation.settings.fontSizePx;
  switchFlow.resolve(true);
  assert.equal(await pendingToggle, true);
  assert.equal(changingLocation.isLiteratureEnabled('dock'), true);
  assert.equal(changingLocation.isLiteratureEnabled('tab'), false);
  assert.deepEqual(changingLocation.events, [], 'A late toggle completion cannot apply to a newly active position');
  assert.equal(changingLocation.settings.fontSizePx, tabFont);
  assert.equal(changingLocation.activeLayoutProfile, 'reading:tab');

  // Edits queued for a mode or position that has since changed must be discarded.
  for(const change of ['mode', 'location']) {
    const queued = pocket();
    const before = JSON.stringify([queued.settings.layoutProfiles, queued.settings.cardLayoutProfiles]);
    const edit = queued.adjustFontSize(1);
    if(change === 'mode') queued.settings.literatureLocations.dock = true;
    else setLocation(queued, 'tab');
    assert.equal(await edit, false);
    assert.equal(JSON.stringify([queued.settings.layoutProfiles, queued.settings.cardLayoutProfiles]), before);
  }

  // A native font response may arrive after the current position changes modes.
  for(const phase of ['initial', 'final']) {
    const race = pocket();
    race.settings.layoutProfiles.dock.fontSizePx = 14;
    race.activateLayoutProfile();
    race.ready = true;
    race.navigationRevision = 1;
    race.appearanceGeneration = 1;
    race.syncNativeReaderPadding = async () => true;
    const response = deferred(), requested = deferred();
    const preferenceKey = race.typographyPreferenceKey();
    let reads = 0, nativeEdits = 0;
    race.refreshFontControls = async () => {
      reads++;
      if(reads === (phase === 'initial' ? 1 : 2)) {requested.resolve(); return response.promise;}
      return {ready:true, size:14, lineHeight:1.9, paragraphSpacing:0, preferenceKey};
    };
    race.webview = {executeJavaScript:async () => {nativeEdits++; return true;}};
    const edit = race.setFontSize(24);
    await requested.promise;
    race.settings.literatureLocations.dock = true;
    race.activateLayoutProfile();
    response.resolve({ready:true, size:phase === 'initial' ? 14 : 24, lineHeight:1.9, paragraphSpacing:0, preferenceKey});
    assert.equal(await edit, false, 'A late ' + phase + ' font-state response cannot edit the new mode');
    assert.equal(race.settings.cardLayoutProfiles.dock.fontSizePx, 12);
    assert.equal(race.settings.layoutProfiles.dock.fontSizePx, 14);
    assert.equal(race.fontBusy, false);
    if(phase === 'initial') assert.equal(nativeEdits, 0);
  }

  // A paged switch begun in ordinary mode can confirm after cards were enabled.
  const flowRace = pocket();
  flowRace.ready = true;
  flowRace.syncNativeReaderPadding = async () => true;
  flowRace.layout = () => {};flowRace.applyPocketDockHeight = () => {};flowRace.syncReadingSurface = () => {};
  const confirmation = deferred(), requested = deferred();
  let nativeFlow = 'scroll', confirmations = 0, reconciliations = 0, reconcileTask;
  flowRace.webview = {executeJavaScript:async script => {
    if(script.includes('__wrpSetReadingFlow')) {
      nativeFlow = script.includes('"paged"') ? 'paged' : 'scroll';
      return true;
    }
    if(!script.includes('flow:document.querySelector')) return {ready:true};
    confirmations++;
    if(confirmations === 1) {requested.resolve(); return confirmation.promise;}
    return {flow:nativeFlow,font:{ready:true}};
  }};
  flowRace.applyAppearance = () => {
    reconciliations++;
    assert.equal(flowRace.isLiteratureEnabled(), true);
    reconcileTask = flowRace.setReadingFlow('scroll');
    return reconcileTask;
  };
  const paged = flowRace.setReadingFlow('paged');
  await requested.promise;
  flowRace.settings.literatureLocations.dock = true;
  flowRace.activateLayoutProfile();
  confirmation.resolve({flow:'paged',font:{ready:true}});
  assert.equal(await paged, true);
  assert.equal(reconciliations, 1, 'A late paged confirmation must reconcile the current card view');
  await reconcileTask;
  assert.equal(flowRace.settings.readingFlow, 'scroll');
  assert.equal(nativeFlow, 'scroll');

  const appearance = pocket();
  appearance.settings.literatureLocations = {floating:false, dock:true, sidebar:true, tab:false};
  appearance.ready = true;
  appearance.appearanceEpoch = 1;
  appearance.navigationRevision = 1;
  appearance.appearanceGeneration = 1;
  const zooms = [], layouts = [];
  appearance.updateHostTheme = () => {};
  appearance.setAppearancePending = value => {appearance.appearancePending = value;};
  appearance.readingPalette = () => ({theme:'dark'});
  appearance.refreshReaderLayout = async () => layouts.push({
    key:appearance.layoutProfileKey(), card:appearance.literatureConfig().enabled,
    font:appearance.layoutProfile().fontSizePx, identity:appearance.typographyPreferenceKey()
  });
  appearance.refreshReaderHeader = async () => {};
  appearance.webview = {
    setZoomFactor:value => zooms.push(value),
    executeJavaScript:async () => ({epoch:appearance.appearanceEpoch, revision:appearance.appearanceRevision, applied:true, bottomHidden:true})
  };
  for(const key of keys) {
    setLocation(appearance, key);
    await Pocket.prototype.applyAppearance.call(appearance);
  }
  assert.deepEqual(zooms, [0.8, 1, 1, 1], 'Only a current compact ordinary view uses the saved browser zoom');
  assert.deepEqual(layouts.map(value => value.card), [false, true, true, false]);
  assert.deepEqual(layouts.map(value => value.font), [14, 12, 12, 24]);

  const header = pocket();
  header.ready = true;
  header.settings.literatureLocations = {floating:false, dock:true, sidebar:true, tab:false};
  const titleEl = {setText:value => {titleEl.text = value;}};
  header.readerView = {titleEl, addShelfButton:{setAttribute:()=>{}}};
  header.webview = {executeJavaScript:async () => ({title:'Original book', addLabel:'', addDisabled:true})};
  setLocation(header, 'tab');
  await header.refreshReaderHeader();
  assert.equal(titleEl.text, 'Original book', 'An ordinary tab keeps its book title when another location uses cards');
  setLocation(header, 'sidebar');
  await header.refreshReaderHeader();
  assert.equal(titleEl.text, 'Research cards');
  header.settings.literatureLocations.sidebar = false;
  await header.refreshReaderHeader();
  assert.equal(titleEl.text, 'Original book');

  assert.deepEqual(notices, []);
  console.log('PASS: legacy/partial location migration, independent modes and profiles, inactive/current toggles, title/zoom/reflow selection, queued edits and asynchronous font/flow/location guards.');
})().catch(error => {console.error(error); process.exitCode = 1;});
