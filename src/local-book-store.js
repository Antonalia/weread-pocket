(function createLocalBookStore(options = {}) {
  // EPUB is indexed in place. Only the selected chapter and requested images
  // are decoded; local files are never extracted, rewritten or sent online.
  const fs = options.fs || require('node:fs');
  const path = options.path || require('node:path');
  const zlib = options.zlib || require('node:zlib');
  const Decoder = options.TextDecoder || TextDecoder;
  const limits = {epubBytes:512*1024*1024, txtBytes:128*1024*1024, entries:20000,
    centralBytes:16*1024*1024, xmlBytes:8*1024*1024, chapterBytes:16*1024*1024,
    imageBytes:8*1024*1024, txtChapterBytes:4*1024*1024, lineBytes:1024*1024,
    styleBytes:256*1024, styleTotalBytes:512*1024, styleSources:16, styleDepth:8,
    styleCacheEntries:8, styleCacheBytes:512*1024,
    ...options.limits};
  const fail = message => { throw new Error(message); };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const textDecoder = (encoding, fatal = false) => new Decoder(encoding, {fatal});
  const utf8 = buffer => textDecoder('utf-8', true).decode(buffer).replace(/^\uFEFF/, '');
  const bookText = buffer => {
    if(buffer.length>=2&&buffer[0]===255&&buffer[1]===254)return textDecoder('utf-16le',true).decode(buffer).replace(/^\uFEFF/,'');
    if(buffer.length>=2&&buffer[0]===254&&buffer[1]===255)return textDecoder('utf-16be',true).decode(buffer).replace(/^\uFEFF/,'');
    return utf8(buffer);
  };
  const crcTable = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0; }
  const crc32 = bytes => { let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0; };
  const entity = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name) => {
    if(name[0]==='#') { const code=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);
      return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'\ufffd'; }
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name.toLowerCase()];
  });
  const localName = name => name.toLowerCase().split(':').pop();
  function attributes(source) {
    const result={},regex=/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;let match;
    while((match=regex.exec(source)))result[localName(match[1])]=entity(match[2]??match[3]??match[4]);
    return result;
  }
  function publisherElement(source,name) {
    const match=source.match(new RegExp('<(?:[\\w.-]+:)?'+name+'\\b([^>]*)>','i'));
    const attrs=match?attributes(match[1]):{};
    return {className:(attrs.class||'').slice(0,4096),id:(attrs.id||'').slice(0,4096),
      style:(attrs.style||'').slice(0,4096),lang:(attrs.lang||'').slice(0,128)};
  }
  // Locate top-level imports without treating comments or quoted text as CSS.
  // Source bytes and recursion are bounded before local ZIP entries are read.
  function cssImports(source) {
    const imports=[];let depth=0,quote='',comment=false;
    for(let index=0;index<source.length;index++) {
      const char=source[index],next=source[index+1];
      if(comment){if(char==='*'&&next==='/'){comment=false;index++;}continue;}
      if(quote){if(char==='\\'){index++;continue;}if(char===quote)quote='';continue;}
      if(char==='/'&&next==='*'){comment=true;index++;continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if(char==='{'){depth++;continue;}if(char==='}'){depth=Math.max(0,depth-1);continue;}
      if(depth||char!=='@'||!/^@import\b/i.test(source.slice(index,index+8)))continue;
      const start=index;let end=index+7,innerQuote='',parentheses=0;
      for(;end<source.length;end++) {
        const current=source[end];
        if(innerQuote){if(current==='\\')end++;else if(current===innerQuote)innerQuote='';continue;}
        if(current==='"'||current==="'")innerQuote=current;
        else if(current==='(')parentheses++;
        else if(current===')')parentheses=Math.max(0,parentheses-1);
        else if((current===';'&&!parentheses)||current==='{'||current==='}')break;
      }
      const stop=end<source.length&&source[end]===';'?end+1:end;
      const statement=source.slice(start,stop);
      const parsed=statement.match(/^@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)|"([^"]*)"|'([^']*)')\s*([^;{}]*);$/i);
      imports.push({start,end:stop,href:parsed?(parsed[1]??parsed[2]??parsed[3]??parsed[4]??parsed[5]):'',media:parsed?parsed[6].trim():''});
      index=Math.max(index,stop-1);
    }
    return imports;
  }
  // A bounded XML reader supports namespace prefixes, comments and CDATA.
  // Harmless DOCTYPE declarations are ignored; entity declarations/internal
  // subsets are rejected and external identifiers are never fetched.
  function xml(source) {
    if (/<!\s*ENTITY\b/i.test(source)||/<!\s*DOCTYPE[^>]*\[/i.test(source)) fail('EPUB 的 XML 包含不支持的实体声明。');
    source=source.replace(/<!\s*DOCTYPE[^<>[\]]*>/gi, '');
    const root={name:'root',attrs:{},children:[],parts:[]},stack=[root];
    const tokens=source.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g)||[];
    if(tokens.length>200000) fail('EPUB 目录结构过于复杂。');
    for(const token of tokens) {
      const parent=stack[stack.length-1];
      if(token.startsWith('<!--')||token.startsWith('<?'))continue;
      if(token.startsWith('<![CDATA[')){parent.parts.push(token.slice(9,-3));continue;}
      if(token.startsWith('</')) {
        const match=token.match(/^<\/\s*([\w:.-]+)\s*>$/);
        if(!match||stack.length===1||stack[stack.length-1].qualified!==match[1])fail('EPUB XML 标签不完整。');
        stack.pop();continue;
      }
      if(token.startsWith('<')) {
        const match=token.match(/^<\s*([\w:.-]+)([\s\S]*?)\/?\s*>$/);
        if(!match||token.startsWith('<!'))fail('EPUB XML 格式无法识别。');
        const attrs={};
        const rest=match[2].replace(/\/\s*$/, '');
        const regex=/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;let attribute;
        while((attribute=regex.exec(rest)))attrs[localName(attribute[1])]=entity(attribute[2]??attribute[3]);
        const node={name:localName(match[1]),qualified:match[1],attrs,children:[],parts:[]};
        parent.children.push(node);parent.parts.push(node);
        if(!/\/\s*>$/.test(token)){stack.push(node);if(stack.length>100)fail('EPUB XML 嵌套过深。');}
      } else parent.parts.push(entity(token));
    }
    if(stack.length!==1)fail('EPUB XML 标签未闭合。');
    return root;
  }
  const descendants = (node, name) => {
    const result=[];const visit=current=>{for(const child of current.children){if(child.name===name)result.push(child);visit(child);}};visit(node);return result;
  };
  const nodeText = node => clean(node.parts.map(part=>typeof part==='string'?part:nodeText(part)).join(''));
  function entryName(name) {
    if(!name||name.includes('\0')||name.includes('\\')||/^(?:\/|[a-z]:)/i.test(name))fail('EPUB 包含不安全的文件路径。');
    const segments=name.split('/');if(segments.some(part=>part==='.'||part==='..'))fail('EPUB 包含越界文件路径。');
    return name;
  }
  function resolveHref(href, base) {
    if(typeof href!=='string'||!href.trim())return null;
    const value=href.trim();
    if(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//')||value.startsWith('/')||value.includes('\\')||value.includes('\0'))return null;
    const hash=value.indexOf('#');let anchor='';
    try { anchor=hash<0?'':decodeURIComponent(value.slice(hash+1)); } catch { return null; }
    const resource=(hash<0?value:value.slice(0,hash)).split('?')[0];
    let decoded;try { decoded=decodeURIComponent(resource); } catch { return null; }
    if(decoded.includes('\\')||decoded.includes('\0')||decoded.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(decoded))return null;
    const resolved=resource?path.posix.normalize(path.posix.join(path.posix.dirname(base),decoded)):base;
    if(resolved==='..'||resolved.startsWith('../')||resolved.startsWith('/'))return null;
    return {href:resolved,anchor};
  }
  async function readAt(handle, offset, length) {
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0)fail('图书文件偏移无效。');
    const buffer=Buffer.alloc(length);let done=0;
    while(done<length){const result=await handle.read(buffer,done,length-done,offset+done);if(!result.bytesRead)fail('图书文件不完整。');done+=result.bytesRead;}
    return buffer;
  }
  async function openEpub(handle, fileSize, filePath) {
    const maxTail=Math.min(fileSize,65557);if(maxTail<22)fail('EPUB 不是完整的 ZIP 文件。');
    let tailLength=22,tail,eocd=-1,tailBytes=0;
    while(true) {
      tail=await readAt(handle,fileSize-tailLength,tailLength);tailBytes+=tailLength;
      for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){eocd=i;break;}
      if(eocd>=0||tailLength===maxTail)break;tailLength=Math.min(maxTail,tailLength*4);
    }
    if(eocd<0)fail('EPUB 不是完整的 ZIP 文件。');
    const disk=tail.readUInt16LE(eocd+4),centralDisk=tail.readUInt16LE(eocd+6);
    const count=tail.readUInt16LE(eocd+10),diskCount=tail.readUInt16LE(eocd+8);
    const centralSize=tail.readUInt32LE(eocd+12),centralOffset=tail.readUInt32LE(eocd+16);
    if(disk||centralDisk||count!==diskCount)fail('暂不支持分卷 EPUB。');
    if(count===65535||centralSize===0xffffffff||centralOffset===0xffffffff)fail('暂不支持 ZIP64 EPUB。');
    if(!count||count>limits.entries||centralSize>limits.centralBytes||centralOffset+centralSize>fileSize-tailLength+eocd)fail('EPUB 文件索引无效或过大。');
    const central=await readAt(handle,centralOffset,centralSize),entries=new Map();let offset=0,totalBytes=0;
    for(let index=0;index<count;index++) {
      if(offset+46>central.length||central.readUInt32LE(offset)!==0x02014b50)fail('EPUB 文件索引损坏。');
      const flags=central.readUInt16LE(offset+8),method=central.readUInt16LE(offset+10),crc=central.readUInt32LE(offset+16);
      const compressed=central.readUInt32LE(offset+20),size=central.readUInt32LE(offset+24);
      const nameLength=central.readUInt16LE(offset+28),extraLength=central.readUInt16LE(offset+30),commentLength=central.readUInt16LE(offset+32);
      const startDisk=central.readUInt16LE(offset+34),attributes=central.readUInt32LE(offset+38),localOffset=central.readUInt32LE(offset+42);
      if(offset+46+nameLength+extraLength+commentLength>central.length)fail('EPUB 文件索引不完整。');
      if(flags&0x41)fail('暂不支持加密 EPUB，请导入可直接打开的图书。');
      if(method!==0&&method!==8)fail('EPUB 使用了不支持的压缩方式。');
      if(startDisk||compressed===0xffffffff||size===0xffffffff||localOffset===0xffffffff)fail('暂不支持分卷或 ZIP64 EPUB。');
      if(((attributes>>>16)&0xf000)===0xa000)fail('EPUB 不允许包含符号链接。');
      let name;try{name=entryName(utf8(central.subarray(offset+46,offset+46+nameLength)));}catch(error){if(error.message.startsWith('EPUB'))throw error;fail('EPUB 文件名编码无效。');}
      if(entries.has(name))fail('EPUB 包含重复文件。');
      if(size>64*1024*1024||compressed>64*1024*1024||size>Math.max(1024*1024,compressed*1000))fail('EPUB 压缩条目过大。');
      totalBytes+=size;if(totalBytes>1024*1024*1024)fail('EPUB 解压后内容过大。');
      if(localOffset+30>centralOffset)fail('EPUB 文件位置无效。');
      entries.set(name,{name,flags,method,crc,compressed,size,offset:localOffset});
      offset+=46+nameLength+extraLength+commentLength;
    }
    if(offset!==central.length)fail('EPUB 文件索引含有无法识别的内容。');
    let closed=false,readBytes=tailBytes+centralSize,chapterReads=0,resourceReads=0,styleReads=0,cssCacheBytes=0;
    const cssCache=new Map(),pendingStyles=new Map();
    async function entryBytes(name,maxBytes) {
      if(closed)fail('图书已关闭。');
      const entry=entries.get(name);if(!entry)fail('EPUB 缺少文件：'+name);
      if(entry.size>maxBytes||entry.compressed>maxBytes+65536)fail('EPUB 内容超过单次读取上限。');
      if(entry.method===0&&entry.compressed!==entry.size)fail('EPUB 存储条目长度无效。');
      const header=await readAt(handle,entry.offset,30);readBytes+=header.length;
      if(header.readUInt32LE(0)!==0x04034b50||header.readUInt16LE(8)!==entry.method||(header.readUInt16LE(6)&0x41))fail('EPUB 文件头损坏。');
      const nameLength=header.readUInt16LE(26),extraLength=header.readUInt16LE(28);
      const dataOffset=entry.offset+30+nameLength+extraLength;
      if(dataOffset+entry.compressed>centralOffset)fail('EPUB 条目越过文件边界。');
      const rawName=await readAt(handle,entry.offset+30,nameLength);
      if(utf8(rawName)!==name)fail('EPUB 文件头与索引不一致。');
      const raw=await readAt(handle,dataOffset,entry.compressed);readBytes+=nameLength+raw.length;
      let result;
      try { result=entry.method===0?raw:zlib.inflateRawSync(raw,{maxOutputLength:maxBytes}); }
      catch { fail('EPUB 压缩内容损坏。'); }
      if(result.length!==entry.size||crc32(result)!==entry.crc)fail('EPUB 内容校验失败。');
      return result;
    }
    async function stylesheetText(name) {
      const cached=cssCache.get(name);
      if(cached){cssCache.delete(name);cssCache.set(name,cached);return cached.text;}
      if(pendingStyles.has(name))return pendingStyles.get(name);
      const pending=(async()=>{
        const entry=entries.get(name);if(!entry||entry.size>limits.styleBytes)return '';
        let text;try{text=bookText(await entryBytes(name,limits.styleBytes));}catch{return '';}
        styleReads++;const bytes=Buffer.byteLength(text,'utf8');
        if(!closed&&bytes<=limits.styleCacheBytes&&limits.styleCacheEntries>0) {
          while(cssCache.size&&(cssCache.size>=limits.styleCacheEntries||cssCacheBytes+bytes>limits.styleCacheBytes)) {
            const first=cssCache.keys().next().value;cssCacheBytes-=cssCache.get(first).bytes;cssCache.delete(first);
          }
          cssCache.set(name,{text,bytes});cssCacheBytes+=bytes;
        }
        return text;
      })();
      pendingStyles.set(name,pending);
      try{return await pending;}finally{pendingStyles.delete(name);}
    }
    async function chapterStyles(html,base) {
      const head=html.match(/<(?:[\w.-]+:)?head\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?head\s*>/i)?.[1]||'';
      const styles=[],state={sources:0,sourceBytes:0},visited=new Set();let outputBytes=0;
      async function expand(text,currentBase,depth) {
        const bytes=Buffer.byteLength(text,'utf8');
        if(!text||bytes>limits.styleBytes||state.sources>=limits.styleSources||state.sourceBytes+bytes>limits.styleTotalBytes)return '';
        state.sources++;state.sourceBytes+=bytes;
        const fragments=[];let offset=0;
        for(const imported of cssImports(text)) {
          fragments.push(text.slice(offset,imported.start));offset=imported.end;
          const resolved=resolveHref(imported.href,currentBase),entry=resolved&&entries.get(resolved.href);
          if(!entry||depth>=limits.styleDepth||visited.has(resolved.href)||entry.size>limits.styleBytes||entry.size+state.sourceBytes>limits.styleTotalBytes||state.sources>=limits.styleSources)continue;
          // Media queries remain local. Unsupported import modifiers are ignored.
          if(imported.media&&(imported.media.length>1024||/[{}@<>]/.test(imported.media)||/\b(?:layer|supports)\s*\(/i.test(imported.media)))continue;
          visited.add(resolved.href);
          const nested=await expand(await stylesheetText(resolved.href),resolved.href,depth+1);
          visited.delete(resolved.href);
          if(nested)fragments.push(imported.media?'@media '+imported.media+' {\n'+nested+'\n}':nested);
        }
        fragments.push(text.slice(offset));return fragments.join('\n');
      }
      const tags=head.replace(/<!--[\s\S]*?-->/g,'').match(/<(?:[\w.-]+:)?style\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?style\s*>|<(?:[\w.-]+:)?link\b[^>]*>/gi)||[];
      for(const tag of tags) {
        if(state.sources>=limits.styleSources||state.sourceBytes>=limits.styleTotalBytes)break;
        const opener=tag.match(/^<[^\s>]+([^>]*)>/),attrs=attributes(opener?.[1]||'');let text='',currentBase=base;
        if(/^<(?:[\w.-]+:)?link\b/i.test(tag)) {
          if(!(attrs.rel||'').toLowerCase().split(/\s+/).includes('stylesheet'))continue;
          const resolved=resolveHref(attrs.href,base),entry=resolved&&entries.get(resolved.href);
          if(!entry||entry.size>limits.styleBytes||entry.size+state.sourceBytes>limits.styleTotalBytes)continue;
          currentBase=resolved.href;visited.add(currentBase);text=await stylesheetText(currentBase);
        } else {
          text=tag.slice(opener[0].length).replace(/<\/(?:[\w.-]+:)?style\s*>$/i,'');
          text=text.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/,'$1');text=entity(text);
        }
        const expanded=await expand(text,currentBase,0);visited.delete(currentBase);
        if(!expanded)continue;
        let wrapped=expanded;
        if(attrs.media&&attrs.media.length<=1024&&!/[{}@<>]/.test(attrs.media))wrapped='@media '+attrs.media+' {\n'+expanded+'\n}';
        const bytes=Buffer.byteLength(wrapped,'utf8');
        if(outputBytes+bytes<=limits.styleTotalBytes){styles.push(wrapped);outputBytes+=bytes;}
      }
      return styles;
    }
    async function xmlEntry(name){try{return xml(bookText(await entryBytes(name,limits.xmlBytes)));}catch(error){if(error.message.startsWith('EPUB')||error.message==='图书已关闭。')throw error;fail('EPUB XML 编码无效。');}}
    const container=await xmlEntry('META-INF/container.xml');
    const rootfile=descendants(container,'rootfile').find(node=>node.attrs['media-type']==='application/oebps-package+xml')||descendants(container,'rootfile')[0];
    if(!rootfile?.attrs['full-path'])fail('EPUB 缺少内容清单。');
    const opfPath=entryName(rootfile.attrs['full-path']),opf=await xmlEntry(opfPath);
    const manifest=descendants(opf,'manifest')[0],spine=descendants(opf,'spine')[0];
    if(!manifest||!spine)fail('EPUB 缺少章节顺序。');
    const items=new Map();
    for(const item of manifest.children.filter(node=>node.name==='item')) {
      const resolved=resolveHref(item.attrs.href,opfPath);
      if(item.attrs.id&&resolved)items.set(item.attrs.id,{id:item.attrs.id,href:resolved.href,type:item.attrs['media-type']||'',properties:item.attrs.properties||''});
    }
    const chapters=[];
    for(const reference of spine.children.filter(node=>node.name==='itemref'&&node.attrs.linear!=='no')) {
      const item=items.get(reference.attrs.idref);
      if(!item||!entries.has(item.href)||!['application/xhtml+xml','text/html'].includes(item.type))fail('EPUB 正文清单包含缺失或不支持的章节。');
      chapters.push({id:item.id,title:'第 '+(chapters.length+1)+' 节',href:item.href});
    }
    if(!chapters.length)fail('EPUB 没有可阅读的章节。');
    if(entries.has('META-INF/encryption.xml')) {
      const encryption=await xmlEntry('META-INF/encryption.xml');
      const obfuscation=['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC'];
      for(const encrypted of descendants(encryption,'encrypteddata')) {
        const method=descendants(encrypted,'encryptionmethod')[0];
        if(!obfuscation.includes(method?.attrs.algorithm||''))fail('暂不支持加密 EPUB，请导入可直接打开的图书。');
        for(const reference of descendants(encrypted,'cipherreference')) {
          const resource=resolveHref(reference.attrs.uri,'encryption.xml');
          if(resource&&chapters.some(chapter=>chapter.href===resource.href))fail('EPUB 正文已加密，无法直接阅读。');
        }
      }
    }
    const navigation=[];
    const addNavigation=(title,href,base)=>{
      const resolved=resolveHref(href,base);if(!resolved)return;
      const chapterIndex=chapters.findIndex(chapter=>chapter.href===resolved.href);
      if(chapterIndex<0)return;const label=clean(title);if(!label)return;
      navigation.push({title:label,chapterIndex,anchor:resolved.anchor});
      if(chapters[chapterIndex].title.startsWith('第 ')&&(!resolved.anchor||!navigation.some(item=>item.chapterIndex===chapterIndex&&item!==navigation[navigation.length-1])))chapters[chapterIndex].title=label;
    };
    const navItem=[...items.values()].find(item=>item.properties.split(/\s+/).includes('nav'));
    const ncxItem=items.get(spine.attrs.toc)||[...items.values()].find(item=>item.type==='application/x-dtbncx+xml');
    if(navItem&&entries.has(navItem.href)) {
      const document=await xmlEntry(navItem.href);
      const nav=descendants(document,'nav').find(node=>(node.attrs.type||'').split(/\s+/).includes('toc'));
      if(nav)for(const link of descendants(nav,'a'))addNavigation(nodeText(link),link.attrs.href,navItem.href);
    }
    if(!navigation.length&&ncxItem&&entries.has(ncxItem.href)) {
      const document=await xmlEntry(ncxItem.href);
      for(const point of descendants(document,'navpoint')) {
        const label=point.children.find(node=>node.name==='navlabel'),content=point.children.find(node=>node.name==='content');
        if(label&&content)addNavigation(nodeText(label),content.attrs.src,ncxItem.href);
      }
    }
    if(!navigation.length)for(let index=0;index<chapters.length;index++)navigation.push({title:chapters[index].title,chapterIndex:index,anchor:''});
    const title=clean(nodeText(descendants(opf,'title')[0]||{parts:[]}))||path.basename(filePath,path.extname(filePath));
    const author=descendants(opf,'creator').map(nodeText).filter(Boolean).join('、');
    const mimeTypes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp'};
    return {title,author,format:'epub',chapters,navigation,
      resolveLink(href,chapterIndex=0) {
        const chapter=chapters[chapterIndex];if(!chapter)return null;
        const resolved=resolveHref(href,chapter.href);if(!resolved)return null;
        const target=chapters.findIndex(item=>item.href===resolved.href);
        return target<0?null:{chapterIndex:target,anchor:resolved.anchor};
      },
      async readChapter(index) {
        if(!Number.isInteger(index)||index<0||index>=chapters.length)fail('章节不存在。');
        const chapter=chapters[index];let html;
        try {html=bookText(await entryBytes(chapter.href,limits.chapterBytes));} catch(error){if(error.message.startsWith('EPUB')||error.message==='图书已关闭。')throw error;fail('EPUB 正文编码无效。');}
        chapterReads++;return {html,href:chapter.href,index,title:chapter.title,
          publisherStyles:await chapterStyles(html,chapter.href),publisherBody:publisherElement(html,'body'),publisherHtml:publisherElement(html,'html')};
      },
      async readResource(href,chapterIndex=0) {
        const chapter=chapters[chapterIndex];if(!chapter)return null;
        const resolved=resolveHref(href,chapter.href);if(!resolved)return null;
        const extension=path.posix.extname(resolved.href).slice(1).toLowerCase(),mime=mimeTypes[extension];
        const entry=entries.get(resolved.href);if(!mime||!entry||entry.size>limits.imageBytes)return null;
        const data=await entryBytes(resolved.href,limits.imageBytes);resourceReads++;return {mime,data};
      },
      async close(){if(closed)return;closed=true;entries.clear();cssCache.clear();cssCacheBytes=0;pendingStyles.clear();await handle.close();},
      stats(){return {fileSize,indexBytes:centralSize,entries:entries.size,readBytes,chapterReads,resourceReads,styleReads,cssCacheBytes,cssCacheEntries:cssCache.size,closed};}
    };
  }
  const heading = line => {
    const value=clean(line);if(!value||value.length>120)return null;
    return /^(?:第[〇零一二三四五六七八九十百千万两\d]{1,20}[章回卷节部篇集](?:\s|[：:、.．]|[^\d])?.*|chapter\s+(?:\d+|[ivxlcdm]+)\b.*|(?:序章|序言|前言|楔子|引子|尾声|后记|番外)(?:\s|[：:、.．]|$).*)$/i.test(value)?value:null;
  };
  async function openTxt(handle,fileSize,filePath) {
    const sample=await readAt(handle,0,Math.min(fileSize,65536));let encoding='utf-8',bom=0,readBytes=sample.length;
    if(sample.length>=3&&sample[0]===239&&sample[1]===187&&sample[2]===191)bom=3;
    else if(sample.length>=2&&sample[0]===255&&sample[1]===254){encoding='utf-16le';bom=2;}
    else if(sample.length>=2&&sample[0]===254&&sample[1]===255){encoding='utf-16be';bom=2;}
    else {
      let even=0,odd=0;for(let i=0;i<sample.length;i++)if(sample[i]===0){if(i%2)odd++;else even++;}
      if(odd>sample.length*.2&&even<sample.length*.02)encoding='utf-16le';
      else if(even>sample.length*.2&&odd<sample.length*.02)encoding='utf-16be';
      else if(even+odd>0)fail('TXT 含有二进制数据，无法作为文本阅读。');
      else {
        // An ASCII introduction cannot determine the encoding of later text.
        // Validate UTF-8 incrementally with a fixed 64 KiB buffer before indexing;
        // legacy Chinese bytes anywhere in the book select GB18030 instead.
        const validator=textDecoder('utf-8',true);let checked=sample.length;
        try {
          validator.decode(sample,{stream:true});
          while(checked<fileSize) {
            const chunk=await readAt(handle,checked,Math.min(65536,fileSize-checked));
            checked+=chunk.length;readBytes+=chunk.length;validator.decode(chunk,{stream:true});
          }
          validator.decode();
        } catch(error) {
          if(error instanceof TypeError||error.name==='TypeError')encoding='gb18030';else throw error;
        }
      }
    }
    const wide=encoding.startsWith('utf-16'),unit=wide?2:1;
    if(wide&&(fileSize-bom)%2)fail('TXT 的 UTF-16 文本不完整。');
    const decoder=textDecoder(encoding),chapters=[];let buffer=Buffer.alloc(0),base=bom,position=bom,hasText=false;
    let current={id:'text-0',title:'正文',start:bom,bodyStart:bom,end:fileSize},continuations=0,currentHasText=false,currentIsHeading=false;
    const flushChapter=end=>{current.end=end;if(currentHasText||currentIsHeading)chapters.push(current);if(chapters.length>limits.entries)fail('TXT 章节数量过多。');};
    function line(bytes,start,end) {
      if(bytes.length>limits.lineBytes)fail('TXT 单行过长，请使用包含正常换行的文本。');
      const value=decoder.decode(bytes);
      if(value.includes('\0'))fail('TXT 含有无法识别的控制字符。');
      if(clean(value))hasText=true;
      const label=heading(value);
      if(label) {
        flushChapter(start);continuations=0;
        current={id:'text-'+chapters.length,title:label,start,bodyStart:end,end:fileSize};currentHasText=false;currentIsHeading=true;
      } else if(start-current.bodyStart>=limits.txtChapterBytes) {
        const oldTitle=current.title.replace(/（续 \d+）$/, '');flushChapter(start);continuations++;
        current={id:'text-'+chapters.length,title:oldTitle+'（续 '+continuations+'）',start,bodyStart:start,end:fileSize};currentHasText=!!clean(value);currentIsHeading=false;
      } else if(clean(value))currentHasText=true;
    }
    while(position<fileSize) {
      const length=Math.min(65536,fileSize-position),chunk=await readAt(handle,position,length);readBytes+=chunk.length;position+=length;
      buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;
      let start=0;
      const codeAt=index=>wide?(encoding==='utf-16le'?buffer[index]|buffer[index+1]<<8:buffer[index]<<8|buffer[index+1]):buffer[index];
      for(let i=0;i+unit<=buffer.length;i+=unit) {
        const code=codeAt(i);if(code!==10&&code!==13)continue;
        // Keep a trailing CR until the next chunk, so split CRLF consumes one
        // line ending. Bare CR, LF and mixed endings use identical byte anchors.
        if(code===13&&i+2*unit>buffer.length&&position<fileSize)break;
        const ending=code===13&&i+2*unit<=buffer.length&&codeAt(i+unit)===10?2*unit:unit;
        line(buffer.subarray(start,i),base+start,base+i+ending);start=i+ending;i=start-unit;
      }
      if(start){buffer=buffer.subarray(start);base+=start;}
      const pendingCR=position<fileSize&&buffer.length>=unit&&codeAt(buffer.length-unit)===13?unit:0;
      if(buffer.length-pendingCR>limits.lineBytes)fail('TXT 单行过长，请使用包含正常换行的文本。');
    }
    if(buffer.length)line(buffer,base,fileSize);
    flushChapter(fileSize);
    if(!hasText)fail('TXT 没有可阅读的正文。');
    if(!chapters.length)chapters.push({...current,start:bom,bodyStart:bom,end:fileSize});
    let closed=false,chapterReads=0;
    return {title:path.basename(filePath,path.extname(filePath)),author:'',format:'txt',encoding,chapters,
      navigation:chapters.map((chapter,chapterIndex)=>({title:chapter.title,chapterIndex,anchor:''})),
      async readChapter(index) {
        if(closed)fail('图书已关闭。');
        if(!Number.isInteger(index)||index<0||index>=chapters.length)fail('章节不存在。');
        const chapter=chapters[index],length=chapter.end-chapter.bodyStart;
        if(length>limits.txtChapterBytes+limits.lineBytes)fail('TXT 章节内容超过读取上限。');
        const bytes=await readAt(handle,chapter.bodyStart,length);readBytes+=bytes.length;chapterReads++;
        const text=decoder.decode(bytes).replace(/^\uFEFF/, '');
        const originalParagraphs=text?text.split(/\r\n|\r|\n/):[];
        // A final terminator does not create a phantom extra line. Real blank
        // lines remain available in original layout but never shift content
        // paragraph indexes used by custom layout, search and reading progress.
        if(/[\r\n]$/.test(text))originalParagraphs.pop();
        const paragraphs=[],originalParagraphIndexes=originalParagraphs.map(value=>{
          const trimmed=value.trim();if(!trimmed)return null;
          const paragraph=paragraphs.length;paragraphs.push(trimmed);return paragraph;
        });
        return {paragraphs,originalParagraphs,originalParagraphIndexes,index,title:chapter.title};
      },
      async readResource(){return null;},
      async close(){if(closed)return;closed=true;await handle.close();},
      stats(){return {fileSize,indexBytes:chapters.length*128,encoding,readBytes,chapterReads,resourceReads:0,closed};}
    };
  }
  return {
    supportedFormats:['epub','txt'],
    async open(filePath) {
      if(typeof filePath!=='string'||!filePath.trim())fail('请选择本地图书文件。');
      const format=path.extname(filePath).slice(1).toLowerCase();
      if(!['epub','txt'].includes(format))fail('目前支持 EPUB 和 TXT 本地图书。');
      let handle;
      try {
        handle=await fs.promises.open(filePath,'r');const stat=await handle.stat();
        if(!stat.isFile())fail('请选择图书文件。');
        if(!stat.size)fail('图书文件为空。');
        if(stat.size>(format==='epub'?limits.epubBytes:limits.txtBytes))fail('图书文件过大：EPUB 上限 512 MiB，TXT 上限 128 MiB。');
        return await (format==='epub'?openEpub:openTxt)(handle,stat.size,filePath);
      } catch(error) {
        if(handle)await handle.close().catch(()=>{});
        if(error.code==='ENOENT')fail('找不到图书文件，请重新选择。');
        if(error.code==='EACCES'||error.code==='EPERM')fail('无法读取图书文件，请检查权限。');
        throw error;
      }
    }
  };
})
