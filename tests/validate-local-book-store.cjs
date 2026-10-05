'use strict';

const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../src/local-book-store.js'),'utf8');
const createStore=vm.runInNewContext(source,{require,TextDecoder,Buffer,Uint32Array});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wrp-local-book-store-'));
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
function zip(entries){
  const local=[],central=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.name),bytes=Buffer.isBuffer(entry.data)?entry.data:Buffer.from(entry.data||'');
    const method=entry.method??8,flags=entry.flags??0x800,compressed=method===0?bytes:zlib.deflateRawSync(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(flags,6);header.writeUInt16LE(method,8);
    header.writeUInt32LE(entry.crc??crc(bytes),14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    const index=Buffer.alloc(46);index.writeUInt32LE(0x02014b50);index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);index.writeUInt16LE(flags,8);index.writeUInt16LE(method,10);
    index.writeUInt32LE(entry.crc??crc(bytes),16);index.writeUInt32LE(compressed.length,20);index.writeUInt32LE(bytes.length,24);index.writeUInt16LE(name.length,28);
    index.writeUInt32LE(offset,42);local.push(header,name,compressed);central.push(index,name);offset+=header.length+name.length+compressed.length;
  }
  const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,centralBytes,end]);
}
const standard=[
  {name:'mimetype',data:'application/epub+zip',method:0},
  {name:'META-INF/container.xml',data:'<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'},
  {name:'OPS/book.opf',data:'<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>示例 &amp; 测试</dc:title><dc:creator>作者甲</dc:creator></metadata><manifest><item id="one" href="Text/one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="Text/second%20chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="image" href="images/pixel.png" media-type="image/png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'},
  {name:'OPS/nav.xhtml',data:'<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/one.xhtml">第一章</a></li><li><a href="Text/second%20chapter.xhtml#part%202">第二章</a></li></ol></nav></body></html>'},
  {name:'OPS/Text/one.xhtml',data:'<html><body><p>正文一。</p><img src="../images/pixel.png"/><script>window.bad=true</script></body></html>'},
  {name:'OPS/Text/second chapter.xhtml',data:'<html><body><p id="part 2">正文二。</p></body></html>'},
  {name:'OPS/images/pixel.png',data:Buffer.from([137,80,78,71,13,10,26,10]),method:0},
  {name:'OPS/images/unsafe.svg',data:'<svg><script>alert(1)</script></svg>'}
];
const write=(name,data)=>{const file=path.join(directory,name);fs.writeFileSync(file,data);return file;};
const replace=(entries,name,data)=>entries.map(entry=>entry.name===name?{...entry,data}:entry);
(async()=>{
  const store=createStore();assert.deepEqual(Array.from(store.supportedFormats),['epub','txt']);
  const originalFs={...fs,promises:{...fs.promises,open:async(...args)=>{
    const handle=await fs.promises.open(...args);handle.readFile=()=>{throw new Error('Whole-book read is forbidden');};return handle;
  }}};
  const lazyStore=createStore({fs:originalFs});
  const book=await lazyStore.open(write('示例.epub',zip(standard)));
  assert.equal(book.title,'示例 & 测试');assert.equal(book.author,'作者甲');assert.equal(book.chapters.length,2);assert.equal(book.chapters[1].title,'第二章');
  assert.equal(book.navigation[1].anchor,'part 2');assert.equal(book.navigation[1].chapterIndex,1);
  assert.equal(book.stats().chapterReads,0,'Opening EPUB must not decode or read chapters');
  assert.equal(book.resolveLink('second%20chapter.xhtml#part%202',0).chapterIndex,1);assert.equal(book.resolveLink('#start',0).anchor,'start');assert.equal(book.resolveLink('https://example.com/book',0),null);
  const chapter=await book.readChapter(1);assert.equal(chapter.href,'OPS/Text/second chapter.xhtml');assert.match(chapter.html,/正文二/);
  assert.equal(book.stats().chapterReads,1);
  const image=await book.readResource('../images/pixel.png',0);assert.equal(image.mime,'image/png');assert.equal(image.data.length,8);
  for(const resource of ['https://example.com/x.png','file:///secret.png','../../../secret.png','%2e%2e/%2e%2e/%2e%2e/secret.png','../images/unsafe.svg'])assert.equal(await book.readResource(resource,0),null,resource);
  await assert.rejects(book.readChapter(50),/章节不存在/);await book.close();await book.close();assert.equal(book.stats().closed,true);await assert.rejects(book.readChapter(0),/已关闭/);
  // NCX is supported when no EPUB 3 navigation document is supplied.
  const ncxEntries=replace(standard.filter(entry=>entry.name!=='OPS/nav.xhtml'),'OPS/book.opf',
    '<package><metadata><title>NCX 示例</title></metadata><manifest><item id="one" href="Text/one.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="toc"><itemref idref="one"/></spine></package>');
  ncxEntries.push({name:'OPS/toc.ncx',data:'<ncx><navMap><navPoint id="one"><navLabel><text>开篇</text></navLabel><content src="Text/one.xhtml#start"/></navPoint></navMap></ncx>'});
  const ncx=await store.open(write('ncx.epub',zip(ncxEntries)));assert.equal(ncx.chapters[0].title,'开篇');assert.equal(ncx.navigation[0].anchor,'start');await ncx.close();
  const doctype=await store.open(write('doctype.epub',zip(replace(standard,'OPS/nav.xhtml','<!DOCTYPE html>'+standard.find(entry=>entry.name==='OPS/nav.xhtml').data))));
  assert.equal(doctype.chapters[0].title,'第一章');await doctype.close();
  const utf16Chapter=Buffer.concat([Buffer.from([255,254]),Buffer.from('<html><body><p>双字节正文。</p></body></html>','utf16le')]);
  const wideEpub=await store.open(write('wide.epub',zip(replace(standard,'OPS/Text/one.xhtml',utf16Chapter))));
  assert.match((await wideEpub.readChapter(0)).html,/双字节正文/);await wideEpub.close();
  // Publisher styles are read lazily from chapter heads, scoped later by the
  // renderer, and never require an external stylesheet or whole-book read.
  const publisherHtml='<html class="book-layout" lang="zh-CN" id="book"><head>'+
    '<link rel="stylesheet" href="../Styles/base.css"/><link rel="stylesheet" href="https://example.com/remote.css"/>'+
    '<link rel="stylesheet" href="../../../outside.css"/><!-- <link rel="stylesheet" href="../Styles/unused.css"/> -->'+
    '<style><![CDATA[p.dialogue { text-indent: 2em; }]]></style></head>'+
    '<body class="chapter body-layout" id="chapter-one" xml:lang="zh-Hans" style="line-height: 1.4"><p class="dialogue">原书正文。</p></body></html>';
  const publisherEntries=[...replace(replace(standard,'OPS/Text/one.xhtml',publisherHtml),'OPS/Text/second chapter.xhtml',
    '<html><head><link rel="stylesheet" href="../Styles/base.css"/></head><body><p>第二章正文。</p></body></html>'),
    {name:'OPS/Styles/base.css',data:'@import "shared.css"; @import url("nested.css") screen and (min-width: 10px); @import "https://example.com/a.css"; @import "../../../outside.css"; body {font-size: 1.1em;} /* @import "unused.css"; */ p::after {content:"@import unused.css";}'},
    {name:'OPS/Styles/shared.css',data:'@import "base.css"; p {margin: 0 0 1em;}'},
    {name:'OPS/Styles/nested.css',data:'p {text-align: left;}'},
    {name:'OPS/Styles/unused.css',data:'p {color: red;}'}];
  const publisherPath=write('publisher.epub',zip(publisherEntries));
  const publisher=await lazyStore.open(publisherPath);assert.equal(publisher.stats().styleReads,0);
  const styled=await publisher.readChapter(0),publisherCSS=Array.from(styled.publisherStyles).join('\n');
  assert.equal(styled.publisherBody.className,'chapter body-layout');assert.equal(styled.publisherBody.id,'chapter-one');
  assert.equal(styled.publisherBody.lang,'zh-Hans');assert.equal(styled.publisherBody.style,'line-height: 1.4');
  assert.equal(styled.publisherHtml.className,'book-layout');assert.equal(styled.publisherHtml.lang,'zh-CN');assert.equal(styled.publisherHtml.id,'book');
  assert.equal(styled.publisherStyles.length,2);assert.match(publisherCSS,/margin: 0 0 1em/);assert.match(publisherCSS,/@media screen and \(min-width: 10px\)/);
  assert.match(publisherCSS,/text-align: left/);assert.match(publisherCSS,/text-indent: 2em/);
  assert(publisherCSS.indexOf('margin: 0 0 1em')<publisherCSS.indexOf('font-size: 1.1em'),'Local imports precede their importing rules');
  assert(publisherCSS.indexOf('font-size: 1.1em')<publisherCSS.indexOf('text-indent: 2em'),'Head stylesheet cascade order is preserved');
  assert.doesNotMatch(publisherCSS,/https:\/\/example\.com|outside\.css|color: red/);
  assert.equal(publisher.stats().styleReads,3,'Only three linked/imported local sheets are read; comments, cycles and external URLs are inert');
  assert.equal(publisher.stats().cssCacheEntries,3);assert(publisher.stats().cssCacheBytes<=512*1024);
  await publisher.readChapter(1);assert.equal(publisher.stats().styleReads,3,'Shared sheets are reused across adjacent chapters');
  await publisher.close();assert.equal(publisher.stats().cssCacheBytes,0);assert.equal(publisher.stats().cssCacheEntries,0);
  const cssLimited=await createStore({limits:{styleCacheEntries:1,styleCacheBytes:128}}).open(publisherPath);
  await cssLimited.readChapter(0);assert(cssLimited.stats().cssCacheEntries<=1);assert(cssLimited.stats().cssCacheBytes<=128);await cssLimited.close();
  const sourceLimited=await createStore({limits:{styleSources:1}}).open(publisherPath);
  const sourceLimitedCSS=(await sourceLimited.readChapter(0)).publisherStyles.join('\n');assert.match(sourceLimitedCSS,/font-size: 1.1em/);assert.doesNotMatch(sourceLimitedCSS,/margin: 0 0 1em|text-indent: 2em/);await sourceLimited.close();
  const tooLargeCSS=[...replace(standard,'OPS/Text/one.xhtml','<html><head><link rel="stylesheet" href="../Styles/large.css"/><style>p {text-indent: 2em}</style></head><body><p>正文仍可读。</p></body></html>'),
    {name:'OPS/Styles/large.css',data:' '.repeat(256*1024+1)}];
  const cssOversize=await store.open(write('large-style.epub',zip(tooLargeCSS)));
  const oversizedChapter=await cssOversize.readChapter(0);assert.match(oversizedChapter.html,/正文仍可读/);assert.equal(cssOversize.stats().styleReads,0);assert.equal(oversizedChapter.publisherStyles.length,1);await cssOversize.close();
  const totalLimited=await createStore({limits:{styleTotalBytes:80}}).open(publisherPath);
  const limitedChapter=await totalLimited.readChapter(0);assert(limitedChapter.publisherStyles.reduce((size,text)=>size+Buffer.byteLength(text),0)<=80);assert.equal(totalLimited.stats().styleReads,0);await totalLimited.close();
  const corruptStyles=publisherEntries.map(entry=>entry.name==='OPS/Styles/shared.css'?{...entry,crc:1}:entry);
  const cssCorrupt=await store.open(write('corrupt-style.epub',zip(corruptStyles)));assert.match((await cssCorrupt.readChapter(0)).publisherStyles.join('\n'),/font-size: 1.1em/);assert.equal(cssCorrupt.stats().styleReads,2);await cssCorrupt.close();
  const boundedAttributes=await store.open(write('style-attributes.epub',zip(replace(standard,'OPS/Text/one.xhtml',
    '<html class="'+ 'a'.repeat(5000)+'"><head><style>p {text-indent: 2em}</style></head><body style="'+ 'x'.repeat(5000)+'"><p>正文。</p></body></html>'))));
  const boundedPayload=await boundedAttributes.readChapter(0);assert.equal(boundedPayload.publisherHtml.className.length,4096);assert.equal(boundedPayload.publisherBody.style.length,4096);await boundedAttributes.close();
  const originalTxt=await store.open(write('original-indent.txt','第一章 缩进\n　　保留全角缩进。\n  Preserve leading spaces.  \n\n无缩进。'));
  const originalTxtChapter=await originalTxt.readChapter(0);
  assert.deepEqual(Array.from(originalTxtChapter.originalParagraphs),['　　保留全角缩进。','  Preserve leading spaces.  ','','无缩进。']);
  assert.deepEqual(Array.from(originalTxtChapter.paragraphs),['保留全角缩进。','Preserve leading spaces.','无缩进。']);await originalTxt.close();
  const blankPrefix=await store.open(write('blank-prefix.txt','\n  \n第一章 A\n内容。\n第二章 B\n内容二。'));assert.equal(blankPrefix.chapters.length,2);assert.equal(blankPrefix.chapters[0].title,'第一章 A');await blankPrefix.close();
  const emptyChapter=await store.open(write('empty-chapter.txt','第1章 A\n第2章 B\n内容。'));assert.equal(emptyChapter.chapters.length,2);assert.equal((await emptyChapter.readChapter(0)).paragraphs.length,0);await emptyChapter.close();
  const txt=await lazyStore.open(write('小说.txt','序言文字。\r\n\r\n第一章 开始\r\n第一段。\r\n第二段。\r\n\r\nChapter 2 A new day\nSecond chapter.\n'));
  assert.equal(txt.format,'txt');assert.equal(txt.title,'小说');assert.equal(txt.chapters.length,3);assert.equal(txt.chapters[1].title,'第一章 开始');
  assert.deepEqual(Array.from((await txt.readChapter(1)).paragraphs),['第一段。','第二段。']);
  assert.deepEqual(Array.from((await txt.readChapter(2)).paragraphs),['Second chapter.']);
  assert.equal(txt.stats().chapterReads,2);assert(txt.stats().indexBytes<1000);await txt.close();
  const utf16le=Buffer.concat([Buffer.from([255,254]),Buffer.from('第一章 测试\n汉字内容。\n','utf16le')]);
  const le=await store.open(write('utf16le.txt',utf16le));assert.equal(le.encoding,'utf-16le');assert.equal((await le.readChapter(0)).paragraphs[0],'汉字内容。');await le.close();
  const utf16be=Buffer.from(utf16le);utf16be.swap16();const be=await store.open(write('utf16be.txt',utf16be));assert.equal(be.encoding,'utf-16be');assert.equal((await be.readChapter(0)).paragraphs[0],'汉字内容。');await be.close();
  const gb=await store.open(write('legacy.txt',Buffer.from([0xd6,0xd0,0xce,0xc4,0x0a])));assert.equal(gb.encoding,'gb18030');assert.equal((await gb.readChapter(0)).paragraphs[0],'中文');await gb.close();
  // Detection checks all UTF-8 bytes in fixed-size chunks, even after a long
  // ASCII introduction. Streaming decode also retains split multibyte units.
  let largestDecode=0;
  class MeasuredDecoder extends TextDecoder {decode(input,options){largestDecode=Math.max(largestDecode,input?.length||0);return super.decode(input,options);}}
  const legacyLate=await createStore({TextDecoder:MeasuredDecoder}).open(write('late-legacy.txt',Buffer.concat([Buffer.from('ASCII introduction.\n'.repeat(5000)),Buffer.from([0xd6,0xd0,0xce,0xc4,10])])));
  assert.equal(legacyLate.encoding,'gb18030');assert(largestDecode<=65536,'Encoding detection and TXT indexing must decode bounded chunks');
  assert.equal((await legacyLate.readChapter(0)).paragraphs.at(-1),'中文');await legacyLate.close();
  const utf8Split=await store.open(write('utf8-split.txt','x'.repeat(65535)+'汉字。\n'));
  assert.equal(utf8Split.encoding,'utf-8');assert((await utf8Split.readChapter(0)).paragraphs[0].endsWith('汉字。'));await utf8Split.close();
  const cr=await store.open(write('cr-only.txt','第1章 A\r第一段。\r\r第2章 B\r第二段。\r'));
  assert.equal(cr.chapters.length,2);assert.deepEqual(Array.from((await cr.readChapter(0)).paragraphs),['第一段。']);
  assert.deepEqual(Array.from((await cr.readChapter(1)).paragraphs),['第二段。']);await cr.close();
  const mixed=await store.open(write('mixed-newlines.txt','第1章 A\r第一段。\r\n\r\n第二段。\n第2章 B\r内容二。\r'));
  assert.equal(mixed.chapters.length,2);const mixedChapter=await mixed.readChapter(0);
  assert.deepEqual(Array.from(mixedChapter.originalParagraphs),['第一段。','','第二段。']);
  assert.deepEqual(Array.from(mixedChapter.originalParagraphIndexes),[0,null,1]);
  assert.deepEqual(Array.from(mixedChapter.paragraphs),['第一段。','第二段。']);await mixed.close();
  const blankLines=await store.open(write('real-blank-lines.txt','第1章 空行\n\n  \n甲。\n\n\n乙。\n'));
  const blanks=await blankLines.readChapter(0);assert.deepEqual(Array.from(blanks.originalParagraphs),['','  ','甲。','','','乙。']);
  assert.deepEqual(Array.from(blanks.originalParagraphIndexes),[null,null,0,null,null,1]);assert.deepEqual(Array.from(blanks.paragraphs),['甲。','乙。']);await blankLines.close();
  const splitCRLF=await createStore({limits:{lineBytes:65535}}).open(write('split-crlf.txt','x'.repeat(65535)+'\r\n第2章 B\r尾段。'));
  assert.equal(splitCRLF.chapters.length,2);assert.equal((await splitCRLF.readChapter(0)).paragraphs[0].length,65535);
  assert.deepEqual(Array.from((await splitCRLF.readChapter(1)).paragraphs),['尾段。']);await splitCRLF.close();
  for(const bigEndian of [false,true]) {
    const bytes=Buffer.concat([Buffer.from([255,254]),Buffer.from('x'.repeat(32767)+'\r\n第2章 B\r尾段。\r','utf16le')]);if(bigEndian)bytes.swap16();
    const wideMixed=await store.open(write('wide-crlf-'+bigEndian+'.txt',bytes));assert.equal(wideMixed.chapters.length,2);
    assert.equal((await wideMixed.readChapter(0)).paragraphs[0].length,32767);assert.deepEqual(Array.from((await wideMixed.readChapter(1)).paragraphs),['尾段。']);await wideMixed.close();
  }
  const boundaries='第1章 A\n'+'段落。\n'.repeat(16000)+'第2章 B\n最后一段。\n';
  const split=await createStore({limits:{txtChapterBytes:40000}}).open(write('bounded.txt',boundaries));
  assert(split.chapters.length>2,'Large chapters must split at line boundaries');
  const recovered=[];for(let i=0;i<split.chapters.length;i++)recovered.push(...(await split.readChapter(i)).paragraphs);
  assert.equal(recovered.filter(value=>value==='段落。').length,16000,'Byte indexing cannot lose or duplicate multi-byte characters');
  assert.equal(recovered[recovered.length-1],'最后一段。');await split.close();
  for(const [name,bytes,reason] of [
    ['encrypted.epub',zip(standard.map((entry,index)=>index===0?{...entry,flags:0x801}:entry)),/加密/],
    ['drm.epub',zip([...standard,{name:'META-INF/encryption.xml',data:'<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><CipherData><CipherReference URI="OPS/Text/one.xhtml"/></CipherData></EncryptedData></encryption>'}]),/加密/],
    ['traversal.epub',zip([...standard,{name:'../escape.txt',data:'bad'}]),/越界/],
    ['absolute.epub',zip([...standard,{name:'/escape.txt',data:'bad'}]),/不安全/],
    ['backslash.epub',zip([...standard,{name:'OPS\\escape.txt',data:'bad'}]),/不安全/],
    ['duplicate.epub',zip([...standard,standard[0]]),/重复/],
    ['crc.epub',zip(standard.map(entry=>entry.name==='META-INF/container.xml'?{...entry,crc:1}:entry)),/校验/],
    ['broken.epub',Buffer.from('not a zip file'),/完整/],
    ['dtd.epub',zip(replace(standard,'META-INF/container.xml','<!DOCTYPE container [<!ENTITY secret SYSTEM "file:///secret">]><container/>')),/实体/],
    ['empty.txt',Buffer.alloc(0),/为空/],
    ['blank.txt',Buffer.from(' \n\n '),/没有可阅读/],
    ['binary.txt',Buffer.from([1,2,0,3,4,5]),/二进制/],
    ['wide-broken.txt',Buffer.from([255,254,65]),/不完整/]
  ])await assert.rejects(store.open(write(name,bytes)),reason,name);
  await assert.rejects(store.open(path.join(directory,'missing.txt')),/找不到/);
  await assert.rejects(store.open(write('unsupported.pdf','pdf')),/支持 EPUB 和 TXT/);
  await assert.rejects(createStore({limits:{txtBytes:3}}).open(write('large.txt','too big')),/过大/);
  await assert.rejects(createStore({limits:{lineBytes:8}}).open(write('long-line.txt','01234567890123456789')),/单行过长/);
  const imageLimited=await createStore({limits:{imageBytes:2}}).open(path.join(directory,'示例.epub'));assert.equal(await imageLimited.readResource('../images/pixel.png',0),null);await imageLimited.close();
  console.log('PASS local EPUB/TXT: lazy ZIP chapters/images/publisher styles, safe local imports/cascade/cache/budgets, original TXT indentation, EPUB 3 and NCX navigation, UTF-8/UTF-16/GB18030, bounded TXT indexing, corruption/encryption/traversal rejection, and close cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('wrp-local-book-store-'));
  fs.rmSync(resolved,{recursive:true,force:true});
});
