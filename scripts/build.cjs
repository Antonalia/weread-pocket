'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const write = (name, value) => fs.writeFileSync(path.join(root, name), value.trimEnd() + '\n', 'utf8');

function uniqueIndex(source, marker, label) {
  const index = source.indexOf(marker);
  if (index < 0 || source.indexOf(marker, index + marker.length) >= 0) {
    throw new Error(label + ' marker must occur exactly once: ' + marker);
  }
  return index;
}

function embedHelper(bridge, filename, markerName, bindingName) {
  const helper = read('src/' + filename).trim();
  const startMarker = '  // ' + markerName + '_START';
  const endMarker = '  // ' + markerName + '_END';
  const start = uniqueIndex(bridge, startMarker, filename);
  const end = uniqueIndex(bridge, endMarker, filename);
  if (end <= start) throw new Error(filename + ' embedding markers are reversed.');
  new vm.Script('(' + helper + ')', {filename});
  return bridge.slice(0, start) + startMarker + '\n'
    + '  const ' + bindingName + ' = ' + helper + ';\n'
    + bridge.slice(end);
}

function assemble() {
  let bridge = read('src/native-reader-bridge.js');
  bridge = embedHelper(bridge, 'create-literature-cards.js', 'WRP_LITERATURE_LAYOUT', 'createLiteratureCards');
  bridge = embedHelper(bridge, 'native-underline-interaction.js', 'WRP_UNDERLINE_INTERACTION', 'createUnderlineInteraction');
  new vm.Script('(' + bridge.trim() + ')', {filename:'src/native-reader-bridge.js'});

  const source = read('src/main.js');
  const startMarker = '      const bind = ';
  const endMarker = '      const walk = async ';
  const start = uniqueIndex(source, startMarker, 'Native reader binding');
  const end = uniqueIndex(source, endMarker, 'Native reader binding');
  if (end <= start) throw new Error('Native reader binding markers are reversed.');
  let main = source.slice(0, start) + startMarker + bridge.trim() + ';\n' + source.slice(end);
  const localStart = uniqueIndex(main, '// WRP_LOCAL_BOOKS_START', 'Local book factories');
  const localEnd = uniqueIndex(main, '// WRP_LOCAL_BOOKS_END', 'Local book factories');
  const reader = embedHelper(read('src/local-reader-surface.js'), 'local-publisher-typography.js', 'WRP_LOCAL_PUBLISHER', 'createLocalPublisherTypography');
  const factories = ['local-book-store.js','local-reader-surface.js','local-books-integration.js'].map(file => {
    const helper = (file === 'local-reader-surface.js' ? reader : read('src/' + file)).trim();
    new vm.Script('(' + helper + ')', {filename:file});
    const binding = {'local-book-store.js':'createLocalBookStore','local-reader-surface.js':'createLocalReaderSurface','local-books-integration.js':'installLocalBooks'}[file];
    return 'const ' + binding + ' = ' + helper + ';';
  }).join('\n');
  main = main.slice(0,localStart) + '// WRP_LOCAL_BOOKS_START\n' + factories + '\nconst localBookTools = installLocalBooks(Pocket,{Modal,Setting,Notice,Menu,createLocalBookStore,createLocalReaderSurface,matchesHotkey,FONT_SIZES});\n' + main.slice(localEnd);
  new vm.Script(main, {filename:'main.js'});
  const styleSource = read('styles.css');
  const styleStart = uniqueIndex(styleSource, '/* WRP_LOCAL_READER_STYLES_START */', 'Local reader styles');
  const styleEnd = uniqueIndex(styleSource, '/* WRP_LOCAL_READER_STYLES_END */', 'Local reader styles');
  const styles = styleSource.slice(0,styleStart) + '/* WRP_LOCAL_READER_STYLES_START */\n' + read('src/local-reader.css').trim() + '\n' + styleSource.slice(styleEnd);
  return {bridge, reader, main, styles};
}

function build() {
  const {bridge, reader, main, styles} = assemble();
  write('src/local-reader-surface.js', reader);
  write('src/native-reader-bridge.js', bridge);
  write('src/main.js', main);
  write('main.js', main);
  write('styles.css', styles);
  console.log('Built main.js from local sources. No vault files or remote services were accessed.');
}

if (require.main === module) {
  try {build();}
  catch (error) {console.error('Build failed: ' + error.message); process.exitCode = 1;}
}

module.exports = {assemble, build};
