(function createLocalReaderSurface(options) {
  const doc = options.document || options.host.ownerDocument;
  const view = doc.defaultView;
  // WRP_LOCAL_PUBLISHER_START
  const createLocalPublisherTypography = (function createLocalPublisherTypography(document) {
  const view=document.defaultView;
  const properties=new Set(('font font-family font-size font-style font-weight font-variant font-variant-caps font-stretch line-height text-indent text-align text-align-last text-decoration text-decoration-line text-decoration-style text-decoration-thickness text-underline-offset text-transform letter-spacing word-spacing white-space word-break overflow-wrap hyphens vertical-align margin margin-top margin-right margin-bottom margin-left margin-block margin-block-start margin-block-end margin-inline margin-inline-start margin-inline-end padding padding-top padding-right padding-bottom padding-left padding-block padding-inline border-width border-style border-top-width border-bottom-width border-left-width border-right-width border-radius list-style-type list-style-position display float clear width min-width max-width height min-height max-height box-sizing break-before break-after break-inside page-break-before page-break-after page-break-inside').split(' '));
  let serial=0;
  // A chapter's virtual html root owns rem sizing. Obsidian's document root
  // must never determine publisher dimensions or receive publisher styles.
  const remValue=(value,rootFont=false)=>{
    let output='',quote='';
    for(let index=0;index<value.length;) {
      const char=value[index];
      if(quote){output+=char;index++;if(char==='\\'&&index<value.length)output+=value[index++];else if(char===quote)quote='';continue;}
      if(char==='"'||char==="'"){quote=char;output+=char;index++;continue;}
      const match=(index===0||!/[\w.-]/.test(value[index-1]))&&value.slice(index).match(/^-?(?:\d*\.)?\d+rem\b/i);
      if(match){const number=Number(match[0].slice(0,-3));output+=rootFont?(number*16)+'px':'calc(var(--wrp-publisher-rem,16px)*'+number+')';index+=match[0].length;}
      else {output+=char;index++;}
    }
    return output;
  };
  const declarations=(style,rootFont=false)=>{
    const output=[];
    for(const name of style){
      const value=style.getPropertyValue(name);
      if(!properties.has(name)||value.length>512||/url\s*\(|expression\s*\(|image\s*\(|attr\s*\(|var\s*\(|[<>@]/i.test(value))continue;
      if([...value.matchAll(/(?:^|[^\w-])(-?\d+(?:\.\d+)?)/g)].some(match=>Math.abs(Number(match[1]))>2000))continue;
      if(name==='display'&&!/^(none|block|inline|inline-block|list-item|table|table-row|table-cell|flow-root)$/.test(value))continue;
      output.push(name+':'+remValue(value,rootFont&&(name==='font-size'||name==='font'))+(style.getPropertyPriority(name)==='important'?' !important':'')+';');
    }
    return output.join('');
  };
  const inline=(raw,rootFont)=>{const node=document.createElement('span');node.style.cssText=String(raw||'').slice(0,4096);return declarations(node.style,rootFont);};
  const attributes=(source,target,record)=>{
    const read=name=>source?.getAttribute?source.getAttribute(name):source?.[name==='class'?'className':name];
    const classes=String(read('class')||'').split(/\s+/).filter(value=>/^[a-zA-Z_][\w-]{0,127}$/.test(value)&&!value.startsWith('wrp-')).slice(0,32).join(' ');
    if(classes)target.dataset.wrpPublisherClass=classes;
    const id=String(read('id')||'').slice(0,128);if(/^[a-zA-Z_][\w-]*$/.test(id))target.dataset.wrpPublisherId=id;
    const lang=String(read('lang')||'').slice(0,32);if(/^[a-zA-Z][a-zA-Z-]*$/.test(lang))target.lang=lang;
    const value=inline(read('style'),target.hasAttribute('data-wrp-publisher-html'));if(value){target.dataset.wrpPublisherNode=String(++serial);record.publisherInline.push([target.dataset.wrpPublisherNode,value,target]);}
  };
  const selectors=value=>{
    const result=[];let start=0,depth=0,quote='';
    for(let i=0;i<=value.length;i++){
      const c=value[i];if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
      if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;
      if(i===value.length||(c===','&&depth===0)){result.push(value.slice(start,i).trim());start=i+1;}
    }
    return result.filter(Boolean);
  };
  const rewrite=selector=>{
    if(selector.length>512)return null;
    let output='';
    for(let index=0;index<selector.length;) {
      const char=selector[index];
      if(char==='[') {
        let end=index+1,quote='';
        for(;end<selector.length;end++) {
          const current=selector[end];
          if(quote){if(current==='\\')end++;else if(current===quote)quote='';}
          else if(current==='"'||current==="'")quote=current;
          else if(current===']')break;
        }
        if(end>=selector.length)return null;
        // Rewrite only the attribute name. Dots, hashes, commas and pseudo
        // names inside quoted values are literal text, not selector tokens.
        output+=selector.slice(index,end+1).replace(/^(\[\s*)(class|id)(?=[\s~|^$*=\]])/i,(_,prefix,name)=>prefix+'data-wrp-publisher-'+name.toLowerCase());
        index=end+1;continue;
      }
      if(char==='"'||char==="'") {
        let end=index+1;for(;end<selector.length;end++){if(selector[end]==='\\')end++;else if(selector[end]===char)break;}
        if(end>=selector.length)return null;output+=selector.slice(index,end+1);index=end+1;continue;
      }
      if(char==='\\'){output+=selector.slice(index,index+2);index+=2;continue;}
      if(/[{}@]/.test(char)||/^(?::host\b|:scope\b|::part\b|::slotted\b)/i.test(selector.slice(index)))return null;
      const identifier=selector.slice(index+(char==='.'||char==='#'?1:0)).match(/^[a-zA-Z_][\w-]*/);
      if((char==='.'||char==='#')&&identifier){output+='[data-wrp-publisher-'+(char==='.'?'class~':'id')+'="'+identifier[0]+'"]';index+=identifier[0].length+1;continue;}
      if(selector.slice(index).match(/^:root\b/i)){output+='[data-wrp-publisher-html]';index+=5;continue;}
      if(identifier&&(index===0||/[\s>+~,(]/.test(selector[index-1]))&&/^(html|body)$/i.test(identifier[0])){
        output+='[data-wrp-publisher-'+identifier[0].toLowerCase()+']';index+=identifier[0].length;continue;
      }
      output+=char;index++;
    }
    return output;
  };
  const compile=(texts,scope,record)=>{
    if(!view?.CSSStyleSheet)return '';
    const prefix='#'+scope;let rules=0,budget=0;
    const visit=list=>{
      let output='';for(const rule of list){if(++rules>2000)break;
        if(rule.type===1){
          for(const selector of selectors(rule.selectorText)){
            const value=rewrite(selector);if(!value)continue;let rootFont=false;
            try {rootFont=!!record.publisherHTML?.matches(value);}catch {continue;}
            const body=declarations(rule.style,rootFont);if(body)output+=prefix+' '+value+'{'+body+'}\n';
          }
        }
        else if((rule.type===4||rule.type===12)&&rule.cssRules){const condition=String(rule.conditionText||'');if(condition.length<=512&&!/[<>@]|url\s*\(/i.test(condition)){const body=visit(rule.cssRules);if(body)output+=(rule.type===4?'@media ':'@supports ')+condition+'{'+body+'}\n';}}
      }return output;
    };
    let output='';for(const text of texts||[]){if(typeof text!=='string'||(budget+=text.length)>524288)break;try{const sheet=new view.CSSStyleSheet();sheet.replaceSync(text);output+=visit(sheet.cssRules);}catch(_){/* A broken publisher rule cannot prevent reading. */}}
    return output;
  };
  const refresh=record=>{
    if(!record.publisherRoot?.isConnected||!record.publisherHTML||!view?.getComputedStyle)return;
    const font=parseFloat(view.getComputedStyle(record.publisherHTML).fontSize);
    const value=(Number.isFinite(font)&&font>0&&font<=2000?font:16)+'px';
    if(record.publisherRoot.style.getPropertyValue('--wrp-publisher-rem')!==value)record.publisherRoot.style.setProperty('--wrp-publisher-rem',value);
  };
  return {attributes,compile,refresh};
});
  // WRP_LOCAL_PUBLISHER_END
  const publisherTypography = createLocalPublisherTypography(doc);
  const publisherScopePrefix = "wrp-publisher-" + Math.random().toString(36).slice(2);
  let publisherScopeSerial = 0;
  // WRP_LOCAL_IMAGE_INFO_START
  const getLocalImageDimensions = (function getLocalImageDimensions(input, mime) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer,input.byteOffset,input.byteLength) : null;
  if (!bytes || bytes.length < 12) return null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, length) => String.fromCharCode(...bytes.subarray(at,at+length));
  const size = (width,height) => Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? {width,height} : null;
  const u24 = at => bytes[at] | bytes[at+1]<<8 | bytes[at+2]<<16;
  if (mime === 'image/png' && bytes.length >= 24 && data.getUint32(0) === 0x89504e47 && text(12,4) === 'IHDR') return size(data.getUint32(16),data.getUint32(20));
  if (mime === 'image/gif' && /^GIF8[79]a$/.test(text(0,6))) return size(data.getUint16(6,true),data.getUint16(8,true));
  if (mime === 'image/bmp' && text(0,2) === 'BM' && bytes.length >= 26) {
    const dib = data.getUint32(14,true);
    return dib === 12 ? size(data.getUint16(18,true),data.getUint16(20,true)) : dib >= 40 ? size(data.getInt32(18,true),Math.abs(data.getInt32(22,true))) : null;
  }
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) return null;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) return null;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (at + 2 > bytes.length) return null;
      const length = data.getUint16(at);
      if (length < 2 || at + length > bytes.length) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return length >= 7 ? size(data.getUint16(at+5),data.getUint16(at+3)) : null;
      at += length;
    }
  }
  if (mime === 'image/webp' && text(0,4) === 'RIFF' && text(8,4) === 'WEBP') {
    let at = 12;
    while (at + 8 <= bytes.length) {
      const kind = text(at,4), length = data.getUint32(at+4,true), start = at+8;
      if (start + length > bytes.length) return null;
      if (kind === 'VP8X' && length >= 10) return size(u24(start+4)+1,u24(start+7)+1);
      if (kind === 'VP8 ' && length >= 10 && bytes[start+3] === 157 && bytes[start+4] === 1 && bytes[start+5] === 42) return size(data.getUint16(start+6,true)&16383,data.getUint16(start+8,true)&16383);
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 47) { const bits=data.getUint32(start+1,true); return size((bits&16383)+1,((bits>>>14)&16383)+1); }
      at = start + length + (length&1);
    }
  }
  if (mime === 'image/avif' && bytes.length >= 24 && text(4,4) === 'ftyp' && /avif|avis/.test(text(8,Math.min(40,bytes.length-8)))) {
    let largest=null;
    // ispe is the fixed 20-byte FullBox describing each AVIF image extent.
    for(let at=4;at+16<=bytes.length;at++) if(text(at,4)==='ispe' && data.getUint32(at-4)===20) { const candidate=size(data.getUint32(at+8),data.getUint32(at+12)); if(candidate&&(!largest||candidate.width*candidate.height>largest.width*largest.height))largest=candidate; }
    return largest;
  }
  return null;
});
  // WRP_LOCAL_IMAGE_INFO_END
  const colors = ['#ffd400', '#ff6666', '#5fb236', '#2ea8e5', '#a28ae5'];
  const blockSelector = 'p,li,h1,h2,h3,h4,h5,h6,pre,dt,dd,td,th';
  const allowedTags = new Set(['DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','FIGURE','FIGCAPTION','P','SPAN','STRONG','EM','B','I','U','S','DEL','SUB','SUP','BR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','CODE','OL','UL','LI','DL','DT','DD','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','HR','A']);
  const forbiddenTags = new Set(['SCRIPT','STYLE','IFRAME','FRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SELECT','OPTION','TEXTAREA','LINK','META','BASE','SVG','MATH','NOSCRIPT','HEAD','TITLE']);
  const finite = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const root = element('div', 'wrp-local-reader');
  const scroll = element('div', 'wrp-local-scroll');
  const content = element('article', 'wrp-local-content');
  const status = element('div', 'wrp-local-status');
  root.tabIndex = 0;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '本地图书阅读');
  scroll.tabIndex = -1;
  status.setAttribute('role', 'status'); status.hidden = true;
  scroll.append(content); root.append(scroll, status); options.host.append(root);

  // Only a small chapter window owns text nodes or resources. Removed chapter
  // records are discarded rather than cached, so a long book stays inexpensive.
  let book = null, chapter = -1, config = {}, records = new Map();
  let disposed = false, generation = 0, progressTimer = null, frame = null, pendingRestore = null, deferredRestore = null;
  let catalog = null, imageBytes = 0, imagePixels = 0, highlightTimer = null, highlighted = null, ownedHighlight = null, lastWheelTurn = 0, maxRenderedChapters = 0, pendingChapterReads = 0;
  let windowTask = null, windowDirty = false, maintenanceFrame = null, shortWindow = false, shortAdvance = null;
  let chapterNavigation = Promise.resolve(), bookRevision = 0;
  const failedAdjacent = new Set();
  let remembered = {chapter:0, paragraph:0, offset:0, percent:0};
  const maxChapters = 3;
  const requestFrame = callback => view?.requestAnimationFrame ? view.requestAnimationFrame(callback) : setTimeout(callback, 0);
  const cancelFrame = id => view?.cancelAnimationFrame ? view.cancelAnimationFrame(id) : clearTimeout(id);
  const invoke = (name, value) => { try { options[name]?.(value); } catch (_) { /* A host callback cannot invalidate a book. */ } };
  const publisherMode = () => config.localTypography === 'publisher' && !config.literature?.enabled;
  const continuous = () => config.continuousChapters === true && (config.readingFlow !== 'paged' || !!config.literature?.enabled);
  const showStatus = (message, error = false) => {
    status.textContent = message || ''; status.hidden = !message;
    status.classList.toggle('is-error', error);
    root.setAttribute('aria-busy', message && !error ? 'true' : 'false');
  };
  const releaseRecord = record => {
    if (highlighted && record.node.contains(highlighted)) clearHighlight();
    record.alive = false;
    for (const [url, resource] of record.resources) { view?.URL?.revokeObjectURL(url); imageBytes -= resource.bytes; imagePixels -= resource.pixels; }
    record.resources.clear(); record.images = []; record.blocks = []; record.paragraphs = [];
    record.publisherTree = []; record.leadingWhitespace = []; record.publisherInline = []; record.publisherRoot?.remove(); record.publisherRoot = null; record.publisherHTML = null; record.publisherStyle = null;
    record.node.remove(); records.delete(record.index);
    imageBytes = Math.max(0, imageBytes); imagePixels = Math.max(0, imagePixels);
  };
  const releaseResources = () => { for (const record of [...records.values()]) releaseRecord(record); };
  const welcome = () => {
    content.replaceChildren();
    const empty = element('div', 'wrp-local-empty');
    empty.append(element('h3', '', '本地书架'), element('p', '', '点击顶栏的书架按钮，添加 EPUB 或 TXT 图书。'));
    content.append(empty);
  };
  const safePath = (href, base) => {
    if (typeof href !== 'string' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href.trim()) || /[\u0000-\u001f]/.test(href)) return null;
    try {
      const url = new URL(href, 'https://wrp.invalid/' + String(base || '').replace(/^\/+/, ''));
      if (url.origin !== 'https://wrp.invalid') return null;
      return {path:decodeURIComponent(url.pathname).replace(/^\/+/, ''), anchor:decodeURIComponent(url.hash.slice(1))};
    } catch (_) { return null; }
  };
  const chapterPath = item => safePath(String(item?.href || item?.path || item?.id || ''), '')?.path || '';
  const makeAnchor = (source, target) => {
    const name = source.getAttribute('id') || (source.tagName === 'A' && source.getAttribute('name'));
    if (name) target.dataset.wrpAnchor = name.slice(0, 512);
  };
  const sanitize = (node, record, depth = 0) => {
    if (node.nodeType === 3) return doc.createTextNode(node.nodeValue || '');
    if (node.nodeType !== 1 || forbiddenTags.has(node.tagName)) return null;
    if (depth > 128) return doc.createTextNode(node.textContent || '');
    if (node.tagName === 'IMG') {
      const holder = element('span', 'wrp-local-image-placeholder', node.getAttribute('alt') ? '图像：' + node.getAttribute('alt') : '图像');
      makeAnchor(node, holder);
      const href = node.getAttribute('src');
      if (href && safePath(href, record.href) && typeof book?.readResource === 'function' && record.images.length < 100) record.images.push({holder, href, alt:node.getAttribute('alt') || '', publisherAttributes:{className:node.getAttribute('class'),id:node.getAttribute('id'),style:node.getAttribute('style'),lang:node.getAttribute('lang'),width:node.getAttribute('width'),height:node.getAttribute('height')}, loaded:false});
      return holder;
    }
    const tag = node.tagName;
    const target = allowedTags.has(tag) ? doc.createElement(tag.toLowerCase()) : doc.createDocumentFragment();
    if (target.nodeType === 1) {
      makeAnchor(node, target); if (!record.searchOnly) publisherTypography.attributes(node, target, record);
      if (tag === 'A') {
        const href = node.getAttribute('href');
        if (href && safePath(href, record.href)) {
          target.dataset.wrpLocalHref = href; target.setAttribute('href', '#'); target.setAttribute('role', 'link');
        }
      }
      if (tag === 'TD' || tag === 'TH') for (const name of ['colspan','rowspan']) {
        const size = finite(node.getAttribute(name), 1, 1, 32);
        if (size > 1) target.setAttribute(name, String(Math.round(size)));
      }
      if (tag === 'OL') {
        const start = Number(node.getAttribute('start'));
        if (Number.isSafeInteger(start) && start !== 1) target.setAttribute('start', String(start));
      }
    } else if (node.getAttribute('id')) {
      const anchor = element('span', 'wrp-local-anchor'); anchor.dataset.wrpAnchor = node.getAttribute('id').slice(0, 512); target.append(anchor);
    }
    for (const child of node.childNodes) { const clean = sanitize(child, record, depth + 1); if (clean) target.append(clean); }
    return target;
  };
  const makeRecord = (payload, index, searchOnly = false) => {
    const record = {index, searchOnly, href:payload.href || book.chapters[index]?.href || '', blocks:[], paragraphs:[], titleAnchors:[], images:[], publisherInline:[], leadingWhitespace:[], whitespaceNormalized:false, publisherTree:[], resources:new Map(), alive:true, imageTask:null, node:element('section', 'wrp-local-chapter')};
    record.node.dataset.wrpChapter = String(index);
    const holder = element('div');
    if (Array.isArray(payload.paragraphs)) {
      for (const value of Array.isArray(payload.originalParagraphs) ? payload.originalParagraphs : payload.paragraphs) {
        const text = typeof value === 'string' ? value : value?.text;
        if (typeof text === 'string') holder.append(element('p', 'wrp-local-text-paragraph' + (text.trim() ? '' : ' wrp-local-blank wrp-local-txt-blank'), text));
      }
    } else if (typeof payload.html === 'string') {
      // Parse into inert template contents and copy only an allowlist. Author
      // scripts, styling, event handlers and external URLs never become live.
      const template = doc.createElement('template'); template.innerHTML = payload.html;
      const body = template.content.querySelector('body') || template.content;
      while (body.firstChild) { const child = body.firstChild, clean = sanitize(child, record); child.remove(); if (clean) holder.append(clean); }
    } else throw new Error('这个章节没有可读取的正文。');
    for (const node of [...holder.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre,blockquote')]) {
      if (!node.textContent.trim() && !node.querySelector('.wrp-local-image-placeholder')) node.classList.add('wrp-local-blank');
    }
    const wrappers = new Set(['DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','FIGURE','FIGCAPTION']);
    const collectBlocks = parent => {
      let inline = null;
      for (const node of [...parent.childNodes]) {
        if (node.nodeType === 1 && wrappers.has(node.tagName)) { inline = null; collectBlocks(node); }
        else if (node.nodeType === 1 && /^(P|H[1-6]|BLOCKQUOTE|PRE|OL|UL|DL|TABLE|HR)$/.test(node.tagName)) { inline = null; record.blocks.push(node); }
        else if ((node.nodeType === 3 && node.nodeValue.trim()) || node.nodeType === 1) {
          if (!inline) { inline = element('p'); parent.insertBefore(inline,node); record.blocks.push(inline); } inline.append(node);
        }
      }
    };
    collectBlocks(holder);
    record.nodeCount = holder.querySelectorAll('*').length;
    if (!searchOnly) {
    record.publisherRoot = element('div','wrp-local-publisher');
    record.publisherRoot.id = publisherScopePrefix + '-' + (++publisherScopeSerial);
    record.publisherHTML = element('wrp-publisher-html'); record.publisherHTML.dataset.wrpPublisherHtml = '';
    const publisherBody = element('wrp-publisher-body'); publisherBody.dataset.wrpPublisherBody = '';
    publisherTypography.attributes(payload.publisherHtml,record.publisherHTML,record);
    publisherTypography.attributes(payload.publisherBody,publisherBody,record);
    publisherBody.append(holder); while(holder.firstChild) publisherBody.insertBefore(holder.firstChild,holder); holder.remove(); record.publisherHTML.append(publisherBody);
    record.publisherRoot.append(record.publisherHTML);
    record.publisherRoot.classList.toggle('is-txt',Array.isArray(payload.paragraphs));
    for (const parent of [record.publisherHTML,publisherBody,...publisherBody.querySelectorAll('div,section,article,main,header,footer,figure,figcaption')]) record.publisherTree.push([parent,[...parent.childNodes]]);
    record.publisherStyle = element('style'); record.publisherStyle.textContent = publisherTypography.compile(payload.publisherStyles,record.publisherRoot.id,record);
        }
    const firstIndex = record.blocks.findIndex(node => !node.classList.contains('wrp-local-blank'));
    const first = record.blocks[firstIndex];
    record.publisherHasHeading = /^H[1-6]$/.test(first?.tagName || '');
    const normalizedHeading = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (first?.nodeType === 1 && /^H[1-6]$/.test(first.tagName) && normalizedHeading(first.textContent) === normalizedHeading(book.chapters[index]?.title || '第 ' + (index + 1) + ' 章')) {
      record.titleAnchors = [first, ...first.querySelectorAll('[data-wrp-anchor]')].map(node => node.dataset.wrpAnchor).filter(Boolean); record.blocks.splice(firstIndex,1);
    }
    // Remember just leading whitespace. Switching typography neither clones
    // paragraphs nor duplicates their text, and original indent remains recoverable.
    for (const block of record.blocks) {
      if (block.tagName !== 'P' || !block.textContent.trim() || block.querySelector('code,pre,.wrp-local-image-placeholder')) continue;
      const walker = doc.createTreeWalker(block, 4);
      let text;
      while ((text = walker.nextNode())) {
        const prefix = text.nodeValue.match(/^[\t \u00a0\u3000\r\n\ufeff]+/)?.[0] || '';
        if (prefix) record.leadingWhitespace.push([text,prefix]);
        if (text.nodeValue.length > prefix.length) break;
      }
      block.classList.add('wrp-local-prose');
    }
    record.paragraphs = record.blocks.flatMap(block => {
      const candidates = block.matches(blockSelector) ? [block, ...block.querySelectorAll(blockSelector)] : [...block.querySelectorAll(blockSelector)];
      const leaves = candidates.filter(node => !node.querySelector(blockSelector) && !node.classList.contains('wrp-local-blank')); return leaves.length ? leaves : block.classList.contains('wrp-local-blank') ? [] : [block];
    });
    record.paragraphs.forEach((node, number) => { node.dataset.wrpParagraph = String(number); });
    return record;
  };
  const shuffledColors = index => {
    let seed = 2166136261;
    for (const character of String(book?.id || book?.title || '') + ':' + index) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    const order = colors.slice();
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return order;
  };
  const chapterButton = (index, text) => {
    const button = element('button', 'wrp-local-chapter-button', text); button.type = 'button';
    button.addEventListener('click', () => { void navigate(index); }); return button;
  };
  const renderRecord = record => {
    const {index, node, blocks} = record; node.replaceChildren();
    const publisher = publisherMode(), normalize = !publisher;
    if (record.whitespaceNormalized !== normalize) {
      for (const [text,prefix] of record.leadingWhitespace) text.nodeValue = normalize ? text.nodeValue.slice(prefix.length) : prefix + text.nodeValue;
      record.whitespaceNormalized = normalize;
    }
    for (const [,value,target] of record.publisherInline) { if (publisher) target.style.cssText = value; else target.removeAttribute("style"); }
    if (publisher) {
      for (const [parent,children] of record.publisherTree) { parent.replaceChildren(); for (const child of children) parent.appendChild(child); }
      record.publisherRoot.replaceChildren(record.publisherStyle,record.publisherHTML);
    }
    if (!continuous() && index > 0) { const previous = element('nav', 'wrp-local-chapter-nav is-previous'); previous.append(chapterButton(index - 1, '上一章')); node.append(previous); }
    const literature = config.literature || {}, quotes = String(literature.english || '').split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
    // Literature cards keep EPUB title anchors without exposing the novel's
    // chapter heading above a reference-style card.
    const title = literature.enabled ? element('div', 'wrp-local-title-anchors') : element('h2', 'wrp-local-chapter-title', book.chapters[index]?.title || '第 ' + (index + 1) + ' 章');
    for (const anchor of record.titleAnchors) { const marker = element('span', 'wrp-local-anchor'); marker.dataset.wrpAnchor = anchor; title.append(marker); }
    if ((!literature.enabled || record.titleAnchors.length) && (!publisher || !record.publisherHasHeading)) node.append(title);
    if (literature.enabled) {
      const groupSize = Math.round(finite(literature.paragraphs, 3, 1, 20)), order = shuffledColors(index);
      for (let i = 0; i < blocks.length; i += groupSize) {
        const card = element('section', 'wrp-local-card'); card.style.setProperty('--wrp-local-card-accent', order[(i / groupSize) % order.length]);
        const header = element('div', 'wrp-local-card-header');
        const icon = element('span', 'wrp-local-card-icon', '☷'); icon.setAttribute('aria-hidden', 'true');
        header.append(icon, element('span', 'wrp-local-card-page', '第' + (Math.floor(i / groupSize) + 1) + '页 ↗'));
        const dots = element('span', 'wrp-local-card-dots', '···'); dots.setAttribute('aria-hidden', 'true'); header.append(dots); card.append(header);
        if (quotes.length) { const quote = element('div', 'wrp-local-card-quote'); quote.append(element('p', '', quotes[(i / groupSize) % quotes.length])); card.append(quote); }
        const body = element('div', 'wrp-local-card-body'); for (const block of blocks.slice(i, i + groupSize)) body.append(block); card.append(body); node.append(card);
      }
    } else if (publisher) node.append(record.publisherRoot);
    else for (const block of blocks) node.append(block);
    if (!blocks.length) node.append(element('p', 'wrp-local-empty-chapter', '这一章没有文字内容。'));
    if (!continuous() && index < book.chapters.length - 1) { const next = element('nav', 'wrp-local-chapter-nav is-next'); next.append(chapterButton(index + 1, '下一章')); node.append(next); }
    else if (index === book.chapters.length - 1) node.append(element('p', 'wrp-local-book-end', '已读到本书末尾'));
  };
  const sortedRecords = () => [...records.values()].sort((a, b) => a.index - b.index);
  const renderBody = () => {
    content.replaceChildren(); root.classList.toggle('is-literature', !!config.literature?.enabled); root.classList.toggle('is-continuous', continuous()); root.classList.toggle('is-publisher', publisherMode());
    if (!book || chapter < 0) { welcome(); return; }
    for (const record of sortedRecords()) { renderRecord(record); content.append(record.node); if(publisherMode()) publisherTypography.refresh?.(record); }
  };

  const paragraphTop = node => node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
  const selectChapter = index => { if (chapter !== index) { chapter = index; invoke('onChapter', chapter); } };
  const visibleRecord = () => {
    const mounted = sortedRecords(); if (!mounted.length) return null;
    let result = mounted[0];
    for (const record of mounted) { if (paragraphTop(record.node) > scroll.scrollTop + 8) break; result = record; }
    return result;
  };
  const captureProgress = () => {
    if (pendingRestore) return {...pendingRestore};
    if (deferredRestore) {
      const anchor = {...deferredRestore}, record = records.get(anchor.chapter);
      if (!book || !scroll.clientHeight || !record?.node.getBoundingClientRect().height) return anchor;
      restoreProgress(anchor); return {...remembered};
    }
    if (!book || chapter < 0 || !scroll.clientHeight) return {...remembered};
    const record = continuous() ? visibleRecord() : records.get(chapter); if (!record) return {...remembered};
    selectChapter(record.index);
    const paragraphs = record.paragraphs;
    let index = 0, low = 0, high = paragraphs.length - 1;
    while (low <= high) { const middle = Math.floor((low + high) / 2); if (paragraphTop(paragraphs[middle]) <= scroll.scrollTop + 8) { index = middle; low = middle + 1; } else high = middle - 1; }
    const node = paragraphs[index];
    const offset = node ? finite((scroll.scrollTop - paragraphTop(node)) / Math.max(1, node.getBoundingClientRect().height), 0, 0, 1) : 0;
    const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const start = continuous() ? paragraphTop(record.node) : 0;
    const length = continuous() ? record.node.getBoundingClientRect().height : extent;
    const atEnd = record.index === book.chapters.length - 1 && scroll.scrollTop >= extent - 3;
    const fraction = atEnd ? 1 : length ? finite((scroll.scrollTop - start) / length, 0, 0, 1) : 1;
    remembered = {chapter:record.index, paragraph:index, offset, percent:Math.round(((record.index + fraction) / book.chapters.length) * 10000) / 100};
    return {...remembered};
  };
  const restoreProgress = progress => {
    if (!book || chapter < 0) return;
    const record = records.get(Number(progress?.chapter)) || records.get(chapter); if (!record) return;
    const index = Math.round(finite(progress?.paragraph, 0, 0, Math.max(0, record.paragraphs.length - 1))), node = record.paragraphs[index], offset = finite(progress?.offset, 0, 0, 1);
    if (!scroll.clientHeight || !record.node.getBoundingClientRect().height) {
      deferredRestore = {...progress,chapter:record.index,paragraph:index,offset};
      chapter = record.index; remembered = {...remembered,...deferredRestore}; return;
    }
    deferredRestore = null;
    if (continuous() && record.node.getBoundingClientRect().height < scroll.clientHeight) {
      shortWindow = true;
      for (const old of [...records.values()]) if (old.index < record.index) releaseRecord(old);
    }
    scroll.scrollTop = node && (index > 0 || offset > 0) ? Math.max(0, paragraphTop(node) + offset * node.getBoundingClientRect().height) : Math.max(0, continuous() ? paragraphTop(record.node) : 0);
    chapter = record.index; remembered = {...remembered, ...progress, chapter, paragraph:index, offset};
  };
  const queueRestore = progress => {
    if (frame != null) cancelFrame(frame);
    pendingRestore = {...progress}; const currentGeneration = generation;
    frame = requestFrame(() => { frame = null; const anchor = pendingRestore; pendingRestore = null; if (!disposed && generation === currentGeneration) { restoreProgress(anchor); scheduleWindow(); } });
  };
  const clearQueuedRestore = restore => {
    if (frame != null) cancelFrame(frame); frame = null;
    const anchor = pendingRestore; pendingRestore = null; if (restore && anchor) restoreProgress(anchor);
  };
  const emitProgress = () => {
    if (progressTimer != null) clearTimeout(progressTimer); progressTimer = null;
    if (!disposed && book && chapter >= 0) invoke('onProgress', captureProgress());
  };
  const scrollToAnchor = (anchor, index = chapter) => {
    if (!anchor) return false;
    const record = records.get(index); if (!record) return false;
    const node = [...record.node.querySelectorAll('[data-wrp-anchor]')].find(item => item.dataset.wrpAnchor === anchor);
    if (!node) return false;
    scroll.scrollTop = Math.max(0, paragraphTop(node) - (node.closest('.wrp-local-title-anchors') ? 0 : 8)); captureProgress(); return true;
  };
  const imageIsNear = request => { const bounds = request.holder.getBoundingClientRect(), area = scroll.getBoundingClientRect(); return request.holder.isConnected && scroll.clientHeight > 0 && bounds.bottom >= area.top - scroll.clientHeight && bounds.top <= area.bottom + scroll.clientHeight; };
  const loadImages = (record, token) => {
    if (record.imageTask && record.imageToken === token) return record.imageTask;
    record.imageToken = token;
    const currentBook = book;
    const run = async () => {
      for (const request of record.images) {
        if (request.loaded || !imageIsNear(request)) continue;
        if (disposed || generation !== token || currentBook !== book || !record.alive) return;
        try {
          const resource = await currentBook.readResource(request.href, record.index);
          if (disposed || generation !== token || currentBook !== book || !record.alive) return;
          request.loaded = true;
          if (!resource || !/^image\/(?:png|jpeg|gif|webp|avif|bmp)$/i.test(resource.mime || '')) continue;
          const size = resource.data?.byteLength ?? resource.data?.size ?? 0;
          if (!size || size > 8 * 1024 * 1024 || imageBytes + size > 24 * 1024 * 1024 || !view?.URL?.createObjectURL) continue;
          const dimensions = getLocalImageDimensions(resource.data,resource.mime), pixels = dimensions ? dimensions.width * dimensions.height : 0;
          if (!pixels || pixels > 12000000 || imagePixels + pixels > 24000000) { request.holder.textContent = request.alt ? '图像：' + request.alt : '图像过大，暂不显示'; continue; }
          const progress = captureProgress(), blob = new view.Blob([resource.data], {type:resource.mime});
          const url = view.URL.createObjectURL(blob); record.resources.set(url, {bytes:size,pixels}); imageBytes += size; imagePixels += pixels;
          const image = element('img', 'wrp-local-image'); if(request.holder.dataset.wrpAnchor)image.dataset.wrpAnchor=request.holder.dataset.wrpAnchor; const attrs = {...request.publisherAttributes};
          let sizeStyle = '';
          for (const name of ['width','height']) { const value = Number(attrs[name]); if (Number.isFinite(value) && value > 0 && value <= 50000) { image.setAttribute(name,String(value)); sizeStyle += name + ':' + value + 'px;'; } }
          attrs.style = sizeStyle + (attrs.style || ''); publisherTypography.attributes(attrs,image,record);
          if (publisherMode()) { const inline = record.publisherInline.find(value=>value[2]===image); if(inline)image.style.cssText=inline[1]; }
          image.alt = request.alt; image.decoding = 'async'; image.loading = 'lazy';
          image.addEventListener('load', () => { if (generation === token && !disposed && record.alive) queueRestore({...remembered}); }, {once:true});
          image.src = url; request.holder.replaceWith(image); queueRestore(progress);
        } catch (_) { /* Unsupported assets keep a readable alt-text placeholder. */ }
      }
    };
    const task = run().finally(() => { if (record.imageTask === task) record.imageTask = null; }); record.imageTask = task; return task;
  };
  const readRecord = async (index, token, currentBook) => {
    pendingChapterReads++;
    let payload;
    try { payload = await currentBook.readChapter(index); } finally { pendingChapterReads--; }
    if (disposed || generation !== token || currentBook !== book) return null;
    return makeRecord(payload, index);
  };
  const keepWindow = center => {
    for (const record of [...records.values()]) if (Math.abs(record.index - center) > 1) releaseRecord(record);
  };
  const extendWindow = async (token, currentBook) => {
    do {
      windowDirty = false;
      if (disposed || token !== generation || currentBook !== book || !continuous()) return;
      clearQueuedRestore(true);
      const progress = captureProgress(); keepWindow(progress.chapter); restoreProgress(progress);
      // Large chapters remain readable without also retaining two large neighbors.
      if ((records.get(progress.chapter)?.nodeCount || 0) > 12000) return;
      // Forward comes first, so reaching the next chapter needs no reload.
      if (shortWindow && records.get(progress.chapter)?.node.getBoundingClientRect().height >= scroll.clientHeight) shortWindow = false;
      for (const index of shortWindow ? [progress.chapter + 1] : [progress.chapter + 1, progress.chapter - 1]) {
        if (index < 0 || index >= currentBook.chapters.length || records.has(index) || failedAdjacent.has(index)) continue;
        let record;
        try { record = await readRecord(index, token, currentBook); }
        catch (error) {
          if (token === generation && currentBook === book && !disposed) { failedAdjacent.add(index); showStatus(error?.message || '相邻章节暂时无法读取。', true); invoke('onError', error?.message || '相邻章节暂时无法读取。'); }
          continue;
        }
        if (!record) return;
        if ([...records.values()].reduce((n,r)=>n+r.nodeCount,0) + record.nodeCount > 20000) { record.alive = false; continue; }
        clearQueuedRestore(true);
        const anchor = captureProgress();
        if (!continuous() || Math.abs(record.index - anchor.chapter) > 1) { record.alive = false; windowDirty = true; continue; }
        if (shortWindow && record.index < anchor.chapter) { record.alive = false; continue; }
        keepWindow(anchor.chapter);
        if (!records.has(record.index)) {
          records.set(record.index, record); renderRecord(record);
          const following = sortedRecords().find(item => item.index > record.index); content.insertBefore(record.node, following?.node || null); publisherTypography.refresh?.(record);
          maxRenderedChapters = Math.max(maxRenderedChapters, records.size);
          restoreProgress(anchor); void loadImages(record, token);
        }
      }
      const current = captureProgress();
      if (current.chapter !== progress.chapter) windowDirty = true;
    } while (windowDirty);
  };
  const scheduleWindow = () => {
    if (disposed || !book || chapter < 0 || !continuous()) return;
    if (windowTask?.token === generation) { windowDirty = true; return; }
    if (maintenanceFrame != null) return;
    const token = generation, currentBook = book;
    maintenanceFrame = requestFrame(() => {
      maintenanceFrame = null;
      if (disposed || token !== generation || currentBook !== book || !continuous()) return;
      const handle = {token, promise:null}; windowTask = handle;
      handle.promise = extendWindow(token, currentBook).finally(() => { if (windowTask === handle) { windowTask = null; if (windowDirty) scheduleWindow(); } });
    });
  };
  const cancelMaintenance = () => {
    if (maintenanceFrame != null) cancelFrame(maintenanceFrame); maintenanceFrame = null; windowDirty = false; failedAdjacent.clear(); shortAdvance = null;
  };
  const onScroll = () => {
    if (!book || chapter < 0 || pendingRestore) return;
    captureProgress(); scheduleWindow(); for (const record of records.values()) void loadImages(record,generation);
    if (progressTimer != null) clearTimeout(progressTimer); progressTimer = setTimeout(emitProgress, 180);
  };
  const closeCatalog = () => { if (catalog) { catalog.remove(); catalog = null; } };
  const updateGutter = () => {
    const desired = publisherMode() ? 8 : finite(config.contentPadding, 16, 4, 320);
    // Fractional host dimensions must reach both card borders unchanged.
    const available = content.getBoundingClientRect().width || scroll.clientWidth || root.clientWidth;
    const maximum = available > 0 ? Math.max(4, (available - 80) / 2) : 320;
    let left = Math.min(desired, maximum), right = left;
    const bounds = config.literature?.enabled ? config.literature.dockBounds : null;
    if (available > 0 && Number.isFinite(bounds?.left) && Number.isFinite(bounds?.right) && bounds.right > bounds.left) {
      left = Math.max(0, Math.min(bounds.left, Math.max(0, available - 80)));
      const edge = Math.max(Math.min(available, left + 80), Math.min(available, bounds.right)); right = Math.max(0, available - edge);
    }
    root.style.setProperty('--wrp-local-gutter', Math.min(desired, maximum) + 'px'); root.style.setProperty('--wrp-local-gutter-left', left + 'px'); root.style.setProperty('--wrp-local-gutter-right', right + 'px');
  };
  const navigate = async (index, anchor, progress) => {
    if (disposed || !book || !book.chapters.length) return false;
    clearQueuedRestore(true);
    index = Math.round(finite(index, chapter < 0 ? 0 : chapter, 0, book.chapters.length - 1)); closeCatalog();
    const existing = records.get(index);
    if (existing && !progress) {
      selectChapter(index);
      if (anchor === '__wrp_end__') scroll.scrollTop = paragraphTop(existing.node) + existing.node.getBoundingClientRect().height - scroll.clientHeight;
      else if (!scrollToAnchor(anchor, index)) restoreProgress({chapter:index,paragraph:0,offset:0});
      emitProgress(); scheduleWindow(); return true;
    }
    if (chapter >= 0) emitProgress();
    const token = ++generation, currentBook = book; deferredRestore = null; cancelMaintenance(); showStatus('正在打开章节…');
    try {
      const record = await readRecord(index, token, currentBook);
      if (!record) return false;
      releaseResources(); chapter = index; records.set(index, record); maxRenderedChapters = Math.max(maxRenderedChapters, records.size); renderBody(); shortWindow = continuous() && record.node.getBoundingClientRect().height < scroll.clientHeight;
      remembered = {chapter, paragraph:0, offset:0, percent:Math.round((chapter / book.chapters.length) * 10000) / 100}; showStatus('');
      if (anchor === '__wrp_end__') scroll.scrollTop = scroll.scrollHeight;
      else if (!scrollToAnchor(anchor, index)) restoreProgress(progress || remembered);
      queueRestore(captureProgress()); invoke('onChapter', chapter); emitProgress(); void loadImages(record, token); scheduleWindow(); return true;
    } catch (error) {
      if (disposed || token !== generation || currentBook !== book) return false;
      const message = error?.message || '章节打开失败，请重新选择图书。'; showStatus(message, true); invoke('onError', message); return false;
    }
  };
  const setBook = async (nextBook, progress) => {
    if (disposed) return false;
    if (book && chapter >= 0) emitProgress(); clearHighlight(); clearQueuedRestore(false); cancelMaintenance();
    ++generation; ++bookRevision; chapterNavigation = Promise.resolve(); releaseResources(); closeCatalog(); book = nextBook || null; chapter = -1; maxRenderedChapters = 0; shortWindow = false; deferredRestore = null;
    remembered = {chapter:0, paragraph:0, offset:0, percent:0}; content.replaceChildren(); scroll.scrollTop = 0;
    if (!book) { showStatus(''); welcome(); return true; }
    if (!Array.isArray(book.chapters) || !book.chapters.length || typeof book.readChapter !== 'function') { const message = '这本书没有可读取的章节。'; showStatus(message, true); invoke('onError', message); return false; }
    return navigate(progress?.chapter || 0, null, progress);
  };

  const applyAppearance = next => {
    if (disposed) return;
    const progress = captureProgress(), wasContinuous = continuous(), oldLiterature = config.literature || {}, literature = next.literature || {};
    const regroup = config.localTypography !== next.localTypography || oldLiterature.enabled !== literature.enabled || oldLiterature.english !== literature.english || oldLiterature.paragraphs !== literature.paragraphs;
    config = {...next, literature:{...literature}};
    const palette = next.palette || {};
    for (const name of ['primary','secondary','border','text','muted','faint']) { const value = palette[name]; if (typeof value === 'string' && value) root.style.setProperty('--wrp-local-' + name, value); else root.style.removeProperty('--wrp-local-' + name); }
    root.style.setProperty('--wrp-local-font-size', finite(next.fontSize ?? next.fontSizePx, 16, 8, 72) + 'px');
    root.style.setProperty('--wrp-local-line-height', String(finite(next.lineHeight, 1.9, 1, 4)));
    root.style.setProperty('--wrp-local-paragraph-spacing', finite(next.paragraphSpacing, 0, 0, 120) + 'px'); updateGutter();
    const family = literature.enabled && literature.fontFamily ? literature.fontFamily : next.fontFamily;
    if (typeof family === 'string' && family.trim()) root.style.fontFamily = family; else root.style.removeProperty('font-family');
    root.dataset.wrpReadingFlow = next.readingFlow === 'paged' && !literature.enabled ? 'paged' : 'scroll';
    if (wasContinuous !== continuous() && book && chapter >= 0) {
      clearQueuedRestore(false); ++generation; cancelMaintenance();
      if (!continuous()) for (const record of [...records.values()]) if (record.index !== progress.chapter) releaseRecord(record);
      chapter = progress.chapter; renderBody();
      for (const record of records.values()) void loadImages(record, generation);
    } else if (regroup && book && chapter >= 0) renderBody();
    root.classList.toggle('is-literature', !!literature.enabled); root.classList.toggle('is-continuous', continuous()); root.classList.toggle('is-publisher', publisherMode());
    if (publisherMode()) for (const record of records.values()) publisherTypography.refresh?.(record);
    if (continuous() && book && records.has(progress.chapter)) {
      // Appearance can first be supplied after setBook, or shrink a chapter
      // beneath the viewport. Prepending then clamps scrollTop into the prior
      // chapter; keep the restored chapter first until it can hold an anchor.
      shortWindow = records.get(progress.chapter).node.getBoundingClientRect().height < scroll.clientHeight;
      if (shortWindow) for (const record of [...records.values()]) if (record.index < progress.chapter) releaseRecord(record);
    }
    queueRestore(progress);
  };
  const turn = async direction => {
    if (!book || chapter < 0 || disposed) return false;
    clearQueuedRestore(true); direction = direction < 0 ? -1 : 1;
    const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    if (!continuous()) {
      if (direction > 0 && scroll.scrollTop >= extent - 3 && chapter < book.chapters.length - 1) return navigate(chapter + 1);
      if (direction < 0 && scroll.scrollTop <= 3 && chapter > 0) return navigate(chapter - 1, '__wrp_end__');
    }
    if (continuous() && ((direction > 0 && scroll.scrollTop >= extent - 1 && chapter < book.chapters.length - 1) || (direction < 0 && scroll.scrollTop <= 1 && sortedRecords()[0]?.index > 0))) { await advanceShortWindow(direction); return true; }
    scroll.scrollTop = Math.max(0, Math.min(extent, scroll.scrollTop + direction * Math.max(40, scroll.clientHeight * 0.88)));
    emitProgress(); scheduleWindow(); return true;
  };
  const scrollLineHeight = () => {
    const configured = finite(config.fontSize ?? config.fontSizePx, 16, 8, 72) * finite(config.lineHeight, 1.9, 1, 4);
    if (!publisherMode() || !view?.getComputedStyle) return configured;
    const progress = captureProgress(), record = records.get(progress.chapter);
    const node = record?.paragraphs[progress.paragraph] || record?.paragraphs.find(item => item.classList.contains('wrp-local-prose'));
    if (!node) return configured;
    const style = view.getComputedStyle(node), height = parseFloat(style.lineHeight);
    if (Number.isFinite(height) && height > 0) return height;
    // CSS 'normal' has no numeric computed value. Text-line positions expose
    // its actual advance without inserting a measuring node into the chapter.
    try {
      const range = doc.createRange(); range.selectNodeContents(node);
      const tops = [...range.getClientRects()].filter(rect => rect.height > 0 && rect.width > 0).map(rect => rect.top).sort((a, b) => a - b);
      const size = parseFloat(style.fontSize) || 16, lines = [];
      for (const top of tops) if (!lines.length || top - lines[lines.length - 1] > size * 0.5) lines.push(top);
      if (lines.length > 1) return (lines[lines.length - 1] - lines[0]) / (lines.length - 1);
      const single = node.getBoundingClientRect().height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0) - (parseFloat(style.borderTopWidth) || 0) - (parseFloat(style.borderBottomWidth) || 0);
      if (lines.length === 1 && single > 0) return single;
      return size * 1.2;
    } catch (_) { return configured; }
  };
  const scrollByDirection = async direction => {
    if (!book || chapter < 0 || disposed || !Number.isFinite(Number(direction)) || Number(direction) === 0) return false;
    clearQueuedRestore(true); direction = Number(direction) < 0 ? -1 : 1;
    if (root.dataset.wrpReadingFlow === 'paged') return turn(direction);
    const before = captureProgress(), previousTop = scroll.scrollTop;
    const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    if (continuous() && ((direction > 0 && previousTop >= extent - 1 && before.chapter < book.chapters.length - 1) || (direction < 0 && previousTop <= 1 && sortedRecords()[0]?.index > 0))) {
      await advanceShortWindow(direction);
      return !disposed && (captureProgress().chapter !== before.chapter || scroll.scrollTop !== previousTop);
    }
    scroll.scrollTop = Math.max(0, Math.min(extent, previousTop + direction * scrollLineHeight() * 3));
    emitProgress(); scheduleWindow(); return Math.abs(scroll.scrollTop - previousTop) > 0.1;
  };
  const navigateChapter = direction => {
    if (!book || chapter < 0 || disposed || !Number.isFinite(Number(direction)) || Number(direction) === 0) return Promise.resolve(false);
    direction = Number(direction) < 0 ? -1 : 1;
    const currentBook = book, revision = bookRevision;
    // Each key press starts from the chapter visible after the previous press.
    // Serializing prevents slow EPUB reads from skipping or overwriting a turn.
    const task = chapterNavigation.then(async () => {
      if (disposed || book !== currentBook || revision !== bookRevision) return false;
      clearQueuedRestore(true);
      const index = captureProgress().chapter + direction;
      if (index < 0 || index >= currentBook.chapters.length) return false;
      return navigate(index);
    });
    chapterNavigation = task.catch(() => false); return task;
  };
  const openCatalog = () => {
    if (disposed || !book) return;
    if (catalog) { closeCatalog(); return; }
    catalog = element('div', 'wrp-local-catalog'); catalog.setAttribute('role', 'dialog'); catalog.setAttribute('aria-label', '章节目录');
    const header = element('div', 'wrp-local-catalog-header'); header.append(element('strong', '', '章节目录'));
    const close = element('button', 'wrp-local-catalog-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭目录'); close.addEventListener('click', closeCatalog); header.append(close);
    const search = element('input', 'wrp-local-catalog-search'); search.type = 'search'; search.placeholder = '搜索章节'; search.setAttribute('aria-label', '搜索章节');
    const list = element('div', 'wrp-local-catalog-list');
    const navigation = Array.isArray(book.navigation) && book.navigation.length ? book.navigation : book.chapters.map((item, index) => ({title:item.title, chapterIndex:index}));
    const renderList = () => {
      list.replaceChildren(); const query = search.value.trim().toLocaleLowerCase();
      for (const item of navigation) {
        const title = String(item.title || '第 ' + (item.chapterIndex + 1) + ' 章');
        if (query && !title.toLocaleLowerCase().includes(query)) continue;
        if (!Number.isInteger(item.chapterIndex) || item.chapterIndex < 0 || item.chapterIndex >= book.chapters.length) continue;
        const button = element('button', 'wrp-local-catalog-item', title); button.type = 'button'; button.classList.toggle('is-active', item.chapterIndex === chapter);
        if (item.chapterIndex === chapter) button.setAttribute('aria-current', 'true'); button.addEventListener('click', () => { void navigate(item.chapterIndex, item.anchor); }); list.append(button);
      }
      if (!list.childElementCount) list.append(element('p', 'wrp-local-catalog-empty', '没有匹配的章节'));
    };
    search.addEventListener('input', renderList); renderList(); catalog.append(header, search, list); root.append(catalog);
    list.querySelector('.is-active')?.scrollIntoView({block:'nearest'}); search.focus();
  };
  const onClick = event => {
    const link = event.target?.closest?.('[data-wrp-local-href]'); if (!link || !root.contains(link) || !book) return;
    event.preventDefault(); const record = records.get(Number(link.closest('[data-wrp-chapter]')?.dataset.wrpChapter));
    const target = safePath(link.dataset.wrpLocalHref, record?.href); if (!target) return;
    const index = book.chapters.findIndex(item => chapterPath(item) === target.path);
    if (index >= 0) void navigate(index, target.anchor);
    else if (target.path === (safePath(record?.href, '')?.path || '')) scrollToAnchor(target.anchor, record.index);
  };
  const onKeyDown = event => {
    if (event.key === 'Escape' && catalog) { event.preventDefault(); closeCatalog(); root.focus(); return; }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable) return;
    const direction = ['ArrowRight','PageDown'].includes(event.key) ? 1 : ['ArrowLeft','PageUp'].includes(event.key) ? -1 : 0;
    if (direction) { event.preventDefault(); void turn(direction); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); clearQueuedRestore(true); scroll.scrollTop += (event.key === 'ArrowDown' ? 1 : -1) * finite(config.fontSize ?? config.fontSizePx, 16, 8, 72) * finite(config.lineHeight, 1.9, 1, 4); scheduleWindow(); }
  };
  const onPointerDown = event => { if (event.target?.closest?.('button,a,input,textarea,select,[contenteditable="true"]')) return; clearQueuedRestore(true); root.focus({preventScroll:true}); };
  const advanceShortWindow = async direction => {
    if (shortAdvance || disposed || !book || !continuous()) return;
    const mounted = sortedRecords(), currentBook = book, token = generation;
    const progress = captureProgress();
    const index = direction > 0 ? progress.chapter + 1 : (mounted[0]?.index ?? progress.chapter) - 1;
    if (index < 0 || index >= currentBook.chapters.length || (direction > 0 && index <= progress.chapter)) { scheduleWindow(); return; }
    const handle = {}; shortAdvance = handle;
    try {
      let record = records.get(index);
      if (!record) record = await readRecord(index, token, currentBook);
      if (!record || disposed || token !== generation || currentBook !== book || !continuous()) return;
      clearQueuedRestore(false);
      for (const old of [...records.values()]) if (old.index < index || old.index > index + 1) releaseRecord(old);
      records.set(index, record); chapter = index; shortWindow = true;
      maxRenderedChapters = Math.max(maxRenderedChapters, records.size); renderBody();
      remembered = {chapter:index,paragraph:0,offset:0,percent:Math.round(index / book.chapters.length * 10000) / 100};
      scroll.scrollTop = direction < 0 ? Math.max(0, record.node.getBoundingClientRect().height - scroll.clientHeight) : 0;
      invoke('onChapter', index); emitProgress(); void loadImages(record, token); scheduleWindow();
    } catch (error) {
      if (!disposed && token === generation && currentBook === book) { showStatus(error?.message || '相邻章节暂时无法读取。', true); invoke('onError', error?.message || '相邻章节暂时无法读取。'); }
    } finally { if (shortAdvance === handle) shortAdvance = null; }
  };
  const onWheel = event => {
    if (!catalog && pendingRestore) clearQueuedRestore(true);
    if (!book || chapter < 0 || event.ctrlKey || catalog) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX; if (!delta) return;
    if (continuous()) {
      const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight), mounted = sortedRecords();
      const atForwardBoundary = delta > 0 && scroll.scrollTop >= extent - 1 && captureProgress().chapter < book.chapters.length - 1;
      const atBackBoundary = delta < 0 && scroll.scrollTop <= 1 && mounted[0]?.index > 0;
      if (atForwardBoundary || atBackBoundary) { event.preventDefault(); void advanceShortWindow(delta < 0 ? -1 : 1); }
      return;
    }
    if (root.dataset.wrpReadingFlow !== 'paged') return;
    event.preventDefault(); const now = Date.now(); if (now - lastWheelTurn < 280) return; lastWheelTurn = now; void turn(delta < 0 ? -1 : 1);
  };
  scroll.addEventListener('scroll', onScroll, {passive:true}); scroll.addEventListener('wheel', onWheel, {passive:false});
  root.addEventListener('click', onClick); root.addEventListener('keydown', onKeyDown); root.addEventListener('pointerdown', onPointerDown);
  const resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(() => {
    if (disposed) return; invoke('onResize'); updateGutter(); if(publisherMode()) for(const record of records.values()) publisherTypography.refresh?.(record); if (book && scroll.clientHeight) queueRestore(pendingRestore || {...remembered});
  }) : null;
  resizeObserver?.observe(scroll); welcome();
  const clearHighlight = () => {
    clearTimeout(highlightTimer); highlightTimer=null;
    highlighted?.classList.remove('wrp-local-search-hit'); highlighted=null;
    if(ownedHighlight && view.CSS?.highlights?.get('wrp-local-search-match')===ownedHighlight) view.CSS.highlights.delete('wrp-local-search-match');
    ownedHighlight=null;
  };
  const matchRange = (node,start,length) => {
    if(!Number.isInteger(start)||start<0||!Number.isInteger(length)||length<=0)return null;
    const walker=doc.createTreeWalker(node,4), end=start+length;
    let text,position=0,previousSpace=true,first=null,last=null;
    while((text=walker.nextNode())) {
      if(text.parentElement.closest('.wrp-local-image-placeholder,.wrp-local-image'))continue;
      for(let offset=0;offset<text.nodeValue.length;offset++) {
        const whitespace=/\s/.test(text.nodeValue[offset]);
        if(whitespace && previousSpace)continue;
        previousSpace=whitespace;
        if(position===start)first=[text,offset];
        if(position===end-1){last=[text,offset+1];break;}
        position++;
      }
      if(last)break;
    }
    if(!first||!last)return null;
    const range=doc.createRange();range.setStart(...first);range.setEnd(...last);return range;
  };
  const navigateToProgress = async (progress,tools={}) => {
    if(!book||disposed)return false;
    const expectedBook=book,revision=bookRevision;clearHighlight();
    const result=await navigate(progress?.chapter,null,progress);
    if(!result||disposed||book!==expectedBook||bookRevision!==revision)return false;
    clearQueuedRestore(false);restoreProgress(progress);
    const record=records.get(Number(progress?.chapter)),node=record?.paragraphs[Number(progress?.paragraph)||0];
    if(tools.highlight && node) {
      highlighted=node;
      const range=matchRange(node,tools.matchStart,tools.matchLength);
      if(range && view.CSS?.highlights && view.Highlight) { ownedHighlight=new view.Highlight(range);view.CSS.highlights.set('wrp-local-search-match',ownedHighlight); }
      else node.classList.add('wrp-local-search-hit');
      if(range) {const box=range.getBoundingClientRect(),area=scroll.getBoundingClientRect();if(box.height)scroll.scrollTop+=box.top-area.top-8;}
      highlightTimer=setTimeout(clearHighlight,2500);
      remembered=captureProgress();queueRestore(remembered);
    } else queueRestore(progress);
    emitProgress();scheduleWindow();return true;
  };
  const getSearchParagraphs = (payload,index) => {
    if (disposed || !book) return []; const record = makeRecord(payload,index,true);
    const texts = record.paragraphs.map(node=>{
      if(!node.matches('.wrp-local-image-placeholder,.wrp-local-image')&&!node.querySelector('.wrp-local-image-placeholder,.wrp-local-image'))return node.textContent.replace(/\s+/g,' ').trim();
      if(node.matches('.wrp-local-image-placeholder,.wrp-local-image'))return '';
      const copy=node.cloneNode(true);for(const image of copy.querySelectorAll('.wrp-local-image-placeholder,.wrp-local-image'))image.remove();return copy.textContent.replace(/\s+/g,' ').trim();
    });
    record.blocks = []; record.paragraphs = []; record.images = []; record.node.remove(); return texts;
  };
  return {
    navigateToProgress, getSearchParagraphs,
    getParagraphText(index, paragraph, maximum=120) { return String(records.get(index)?.paragraphs[paragraph]?.textContent || '').replace(/\s+/g,' ').trim().slice(0,Math.max(0,Math.min(500,maximum))); },
    setBook, applyAppearance, navigate, turn, scrollByDirection, navigateChapter, captureProgress, openCatalog,
    preserveProgress() { if (!disposed && book && records.size) queueRestore(captureProgress()); },
    destroy() {
      if (disposed) return; clearHighlight(); emitProgress(); disposed = true; ++generation; ++bookRevision;
      if (progressTimer != null) clearTimeout(progressTimer); clearQueuedRestore(false); cancelMaintenance();
      resizeObserver?.disconnect(); releaseResources(); closeCatalog(); scroll.removeEventListener('scroll', onScroll); scroll.removeEventListener('wheel', onWheel);
      root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKeyDown); root.removeEventListener('pointerdown', onPointerDown); root.remove(); book = null; deferredRestore = null;
    },
    get root() { return root; },
    get book() { return book; },
    get chapter() { return chapter; },
    get stats() { return {renderedChapters:records.size, maxRenderedChapters, maxChapters, chapterIndexes:sortedRecords().map(record => record.index), imageBytes, imagePixels, renderedNodes:[...records.values()].reduce((n,r)=>n+r.nodeCount,0), pendingChapterReads, awaitingLayout:!!deferredRestore, continuous:continuous()}; }
  };
})
