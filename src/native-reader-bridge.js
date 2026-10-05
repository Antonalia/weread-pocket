function bindNativeReader() {
  if(!this.$options || !this.$store) return false;
  let reader = this;
  while(reader && reader.$options.name !== 'HorizontalReader' && typeof reader.findObjsWithPoints !== 'function') reader = reader.$parent;
  if(!reader) return false;
  let union = reader;
  while(union && typeof union.handleSwitchMode !== 'function') union = union.$parent;
  const store = this.$store;
  const render = store.state.readerRender;
  const vertical = render ? { canvasTop: render.canvasTop, canvasBottom: render.canvasBottom } : null;
  const legacy = typeof reader.findObjsWithPoints === 'function';
  // WRP_PAGED_INSETS_START
  const nativePagedInsets = function nativePagedInsets(viewport, headers = [], pagers = []) {
    const height = Number(viewport?.height), top = Number(viewport?.top);
    if(!Number.isFinite(height) || height <= 0 || !Number.isFinite(top)) return null;
    const bottom = top + height;
    // Reserve the native 32px pager plus its 24px bottom inset and an 8px gap.
    // Small guests omit the repeated page heading so useful text still fits.
    let canvasTop = height <= 160 ? 12 : 40, canvasBottom = 64;
    const visible = rect => rect && Number(rect.width) > 0 && Number(rect.height) > 0 &&
      Number.isFinite(rect.top) && Number.isFinite(rect.bottom) &&
      rect.top >= top - 1 && rect.bottom <= bottom + 1;
    for(const rect of headers) if(visible(rect)) canvasTop = Math.max(canvasTop, Math.ceil(rect.bottom - top + 8));
    for(const rect of pagers) if(visible(rect)) canvasBottom = Math.max(canvasBottom, Math.ceil(bottom - rect.top + 8));
    return {canvasTop, canvasBottom};
  };
  // WRP_PAGED_INSETS_END

  const cache = new Map(), failures = new Map(), watches = [];
  let layer = null, timer = null, enabled = true, lastDraw = null, disposed = false, pendingDraw = null, drawRevision = 0;
  // Reserve space before native collection: the original canvases, offsets,
  // selection and progress continue to describe the same Chinese text.
  let literature = { enabled:false, english:'', paragraphs:3, fontFamily:'sans-serif' }, literatureStyle = null;
  const originalCollect = legacy && typeof reader.collectPreRenderInfos === 'function' ? reader.collectPreRenderInfos : null;
  // WRP_LITERATURE_LAYOUT_START
  const createLiteratureCards = function createLiteratureCards({ reader, chapterKey, getParagraphSpacing, getConfig, eventDocument = document }) {
  let cards = [], layer = null, key = null, version = null, disposed = false;
  const overrides = new Map();
  const colors = ['#ffd400', '#ff6666', '#5fb236', '#2ea8e5', '#a28ae5'];
  const element = (tag, name, text) => {
    const node = eventDocument.createElement(tag); node.className = name;
    if(text != null) node.textContent = text;
    return node;
  };
  const restore = () => {
    for(const [node, properties] of overrides) for(const [name, saved] of properties) {
      if(saved.value) node.style.setProperty(name, saved.value, saved.priority);
      else node.style.removeProperty(name);
    }
    overrides.clear();
  };
  const reserve = (node, name, value) => {
    if(!overrides.has(node)) overrides.set(node, new Map());
    const properties = overrides.get(node);
    if(!properties.has(name)) properties.set(name, { value:node.style.getPropertyValue(name), priority:node.style.getPropertyPriority(name) });
    node.style.setProperty(name, value, 'important');
  };
  const clear = () => { layer?.remove(); layer = null; cards = []; key = null; version = null; restore(); };
  // Vue refs may be component instances or v-for arrays during a mode switch.
  // Decorations work only with actual DOM elements from the current reader.
  const domRef = value => {
    if(Array.isArray(value)) { for(const item of value) { const node=domRef(item); if(node)return node; } return null; }
    const node=value?.$el||value;
    return node&&node.isConnected!==false&&typeof node.querySelectorAll==='function'&&typeof node.getBoundingClientRect==='function' ? node : null;
  };
  const find = (scope,selector) => domRef(typeof scope?.querySelector==='function' ? scope.querySelector(selector) : null);
  const chapterDOM = () => domRef(reader.$refs.readerChapterContent);
  const quoteStyle = t => `margin:0;padding:0 0 0 8px;border-left:2px solid;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:${t.fontWeight};font-size:${t.fontSize};line-height:${t.lineHeight};font-family:${t.fontFamily};text-align:left;text-justify:none;letter-spacing:normal;word-spacing:0;`;
  const prepare = () => {
    clear();
    const config = getConfig();
    if(disposed || !config.enabled) return;
    const root = domRef(reader.$refs.preRenderContainer)||find(chapterDOM(),'.preRenderContainer')||find(eventDocument,'.wr_page_reader .readerChapterContent .preRenderContainer');
    const content = find(root,'.preRenderContent')||domRef(reader.$refs.preRenderContent)||root;
    if(!root || !content || root.clientWidth < 60) return;
    const paragraphs = [...content.querySelectorAll('p')];
    const english = config.english.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
    if(!paragraphs.length || !english.length) return;
    const width = root.getBoundingClientRect().width;
    const style = getComputedStyle(paragraphs[0]);
    const typography = Object.fromEntries(['fontSize','lineHeight','fontFamily','fontWeight','letterSpacing','wordSpacing'].map(name => [name, style[name]]));
    const size = parseFloat(typography.fontSize) || 12;
    const headerHeight = Math.ceil(size * 1.6) + 12;
    const gap = 12, inset = 8, border = 1;
    const measure = element('div','wrp-literature-measure');
    measure.style.cssText = quoteStyle(typography) + `position:absolute;visibility:hidden;pointer-events:none;left:-100000px;top:0;width:${Math.max(20, width - 2 * (border + inset))}px;`;
    eventDocument.body.appendChild(measure);
    // Shuffle the five accents from the chapter key. Recollection and moving
    // the same chapter between surfaces retain its colors without a cache.
    let colorSeed = 2166136261;
    for(const character of String(chapterKey() ?? '')) colorSeed = Math.imul(colorSeed ^ character.charCodeAt(0), 16777619) >>> 0;
    const colorOrder = colors.slice();
    for(let index = colorOrder.length - 1; index > 0; index--) {
      colorSeed = (Math.imul(colorSeed, 1664525) + 1013904223) >>> 0;
      const swap = colorSeed % (index + 1);
      [colorOrder[index], colorOrder[swap]] = [colorOrder[swap], colorOrder[index]];
    }
    const heights = new Map(), groups = [];
    try {
      // The native collector reads these insets before drawing the original
      // Chinese canvases. Text offsets and selection remain native.
      for(const p of paragraphs) {
        reserve(p,'padding-left',`${border + inset}px`);
        reserve(p,'padding-right',`${border + inset}px`);
        reserve(p,'box-sizing','border-box');
      }
      for(let start = 0; start < paragraphs.length; start += config.paragraphs) {
        const group = paragraphs.slice(start, start + config.paragraphs), quote = english[groups.length % english.length];
        if(!heights.has(quote)) { measure.textContent = quote; heights.set(quote, Math.ceil(measure.getBoundingClientRect().height)); }
        const quoteHeight = heights.get(quote), quoteTop = headerHeight + 4;
        const bodyTop = border + quoteTop + quoteHeight + 9;
        reserve(group[0],'padding-top',`${bodyTop}px`);
        reserve(group.at(-1),'padding-bottom',`${getParagraphSpacing() + 4 + border + gap}px`);
        groups.push({ group, color:colorOrder[groups.length % colorOrder.length], english:quote, typography, headerHeight, quoteTop, quoteHeight });
      }
      const origin = root.getBoundingClientRect();
      cards = groups.map(({group, ...card}) => {
        const first = group[0].getBoundingClientRect(), last = group.at(-1).getBoundingClientRect();
        return { ...card, x:0, y:first.top - origin.top, width, height:last.bottom - first.top - gap };
      });
    } finally { measure.remove(); }
  };
  const draw = () => {
    const target = domRef(reader.$refs.renderTargetContainer)||find(chapterDOM(),'.renderTargetContainer')||find(eventDocument,'.wr_page_reader .readerChapterContent .renderTargetContainer');
    if(disposed || reader._isDestroyed || !getConfig().enabled || !cards.length || key !== chapterKey() || version !== reader.renderContentsVersion || reader.chapterContentState !== 'DONE') { layer?.remove(); layer = null; return; }
    if(!target?.isConnected || (layer?.parentElement === target && layer.dataset.wrpVersion === String(version))) return;
    const next = element('div','wrp-literature-cards');
    next.dataset.wrpVersion = String(version);
    // Canvas chunks are opaque at z-index 2. Transparent decorations must be
    // above them; otherwise borders disappear in the middle of a card.
    next.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;color:var(--wrp-text-normal);';
    layer?.remove(); target.appendChild(next); layer = next;
    for(const [index, card] of cards.entries()) {
      const color = card.color, box = element('section','wrp-literature-card');
      box.style.cssText = `position:absolute;box-sizing:border-box;border:1px solid var(--wrp-border);border-radius:4px;left:0;right:0;top:${card.y}px;height:${card.height}px;background:transparent;`;
      next.appendChild(box);
      // Zoom can quantize a 1px border to a fractional CSS width. Match the
      // native paragraph's 9px edge using the painted border, not a guess.
      const paintedBorder=parseFloat(getComputedStyle(box).borderLeftWidth)||1;
      const quoteInset=Math.max(0,9-paintedBorder);
      const bottomBorder=parseFloat(getComputedStyle(box).borderBottomWidth)||1;
      box.style.height=(card.height-(1-bottomBorder))+'px';
      const header = element('div','wrp-literature-card-header');
      const ui = `font-family:${card.typography.fontFamily};font-size:${card.typography.fontSize};font-weight:400;line-height:1.4;`;
      header.style.cssText = `position:absolute;left:0;right:0;top:0;height:${card.headerHeight}px;display:flex;align-items:center;gap:8px;padding:0 8px;border-bottom:1px solid var(--wrp-border);box-sizing:border-box;${ui}color:var(--wrp-text-muted);`;
      const icon = element('span','wrp-literature-icon','☷'); icon.style.color = color;
      const page = element('span','wrp-literature-page',`第${index + 1}页 ↗`);
      const more = element('span','wrp-literature-more','⋯'); more.style.marginLeft = 'auto';
      header.appendChild(icon); header.appendChild(page); header.appendChild(more);
      const quote = element('div','wrp-literature-english',card.english);
      quote.style.cssText = quoteStyle(card.typography) + `position:absolute;left:${quoteInset}px;right:${quoteInset}px;top:${card.quoteTop}px;border-color:${color};`;
      const divider = element('div','wrp-literature-body-divider');
      divider.style.cssText = `position:absolute;left:0;right:0;top:${card.quoteTop + card.quoteHeight + 4}px;border-top:1px solid var(--wrp-border);`;
      box.appendChild(header); box.appendChild(quote); box.appendChild(divider);
    }
  };
  return {
    prepare, draw, clear,
    collected(chapter, renderVersion) { if(disposed || chapter !== chapterKey()) return; key = chapter; version = renderVersion; draw(); },
    dispose() { disposed = true; clear(); }
  };
};
  // WRP_LITERATURE_LAYOUT_END
  const cardLayout = legacy ? createLiteratureCards({reader,chapterKey:()=>chapterKey(),getParagraphSpacing:()=>paragraphSpacing,getConfig:()=>literature}) : null;
  const collectWithCards = originalCollect && function() {
    // Decoration failures must never abort the official text collector: its
    // font API swallows errors and otherwise leaves the whole book PRERENDER.
    try {cardLayout?.prepare();}catch{try{cardLayout?.clear();}catch{}}
    const key = chapterKey();
    return Promise.resolve(originalCollect.apply(this,arguments)).then(result=>{
      if(!disposed) {try{cardLayout?.collected(key,reader.renderContentsVersion);}catch{try{cardLayout?.clear();}catch{}}}
      return result;
    });
  };
  if(collectWithCards) reader.collectPreRenderInfos = collectWithCards;
  const rangeOf = value => {
    if(typeof value === 'string') {
      const match = /^(\d+)-(\d+)$/.exec(value);
      return match ? { start: Number(match[1]), end: Number(match[2]) + 1 } : null;
    }
    if(value && Number.isFinite(value.start) && Number.isFinite(value.end)) return { start: value.start, end: value.end };
    return null;
  };
  const subtract = (range, own) => {
    let pieces = [range];
    for(const note of own) pieces = pieces.flatMap(piece => {
      if(note.end <= piece.start || note.start >= piece.end) return [piece];
      const result = [];
      if(note.start > piece.start) result.push({ start: piece.start, end: note.start });
      if(note.end < piece.end) result.push({ start: note.end, end: piece.end });
      return result;
    });
    return pieces;
  };
  const chapterKey = () => reader.bookId && reader.currentChapter?.chapterUid != null ? `${reader.bookId}:${reader.currentChapter.chapterUid}` : null;
  // WRP_UNDERLINE_INTERACTION_START
  const createUnderlineInteraction = function createNativeUnderlineInteraction({ reader, store, chapterKey, isEnabled, requestReviews = null, eventDocument = document, environment = window }) {
  let disposed = false, marks = [], marksChapter = null, marksVersion = null, gesture = null, revision = 0, requestSerial = 0, cache = null;
  let notesPanel = null, notesRoot = null, restoreNotesHide = null, notesSerial = 0;
  const stopScrollPropagation = event => {
    if(typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    else event.stopPropagation?.();
  };
  const notesWheel = event => {
    if(!notesPanel || event.ctrlKey || !event.deltaY) return;
    stopScrollPropagation(event);
    // Inside the list, preserve native scrolling, including a long individual
    // note. Outside it, never send the gesture through to the book.
    if(!notesPanel.contains(event.target)) event.preventDefault();
  };
  const notesKey = event => {
    if(!notesPanel || event.ctrlKey || event.metaKey || event.altKey || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const keys = ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Spacebar'];
    if(!keys.includes(event.key)) return;
    event.preventDefault(); stopScrollPropagation(event);
    const line = parseFloat(environment.getComputedStyle?.(notesPanel.querySelector('.readerReviewDetail_item > .content') || notesPanel)?.lineHeight) || 22.4;
    const page = Math.max(line, notesPanel.clientHeight * .8), extent = Math.max(0, notesPanel.scrollHeight - notesPanel.clientHeight);
    const delta = event.key === 'ArrowUp' ? -line : event.key === 'ArrowDown' ? line : event.key === 'PageUp' || ([' ','Spacebar'].includes(event.key) && event.shiftKey) ? -page : page;
    notesPanel.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? extent : Math.max(0, Math.min(extent, notesPanel.scrollTop + delta));
  };
  const releaseNotesScroll = () => {
    notesSerial++;
    eventDocument.removeEventListener('wheel', notesWheel, true);
    eventDocument.removeEventListener('keydown', notesKey, true);
    notesPanel?.classList?.remove('wrp-notes-scroll-active');
    notesRoot?.classList?.remove('wrp-notes-open');
    notesPanel = null; notesRoot = null;
    const restore = restoreNotesHide; restoreNotesHide = null; restore?.();
  };
  const lockNotesScroll = panel => {
    notesPanel = panel;
    notesRoot = eventDocument.documentElement || eventDocument.scrollingElement;
    notesRoot?.classList?.add('wrp-notes-open');
    panel.classList?.add('wrp-notes-scroll-active');
    eventDocument.addEventListener('wheel', notesWheel, {capture:true,passive:false});
    eventDocument.addEventListener('keydown', notesKey, true);
  };
  const active = (key, version, token, refreshedRange = null) => !disposed && isEnabled() && chapterKey() === key && (reader.renderContentsVersion === version || (refreshedRange && marksChapter === key && marksVersion === reader.renderContentsVersion && marks.some(mark => mark.range.start === refreshedRange.start && mark.range.end === refreshedRange.end))) && reader.chapterContentState === 'DONE' && revision === token && !reader._isDestroyed;
  const rangeValue = range => range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start ? { start:range.start, end:range.end } : null;
  const message = text => { if(typeof reader.$toast === 'function') reader.$toast(text, 1800); };
  const fetchReviews = requestReviews || (async ({ bookId, chapterUid, range }, signal) => {
    const payload = { bookId, chapterUid, reviews:[{ range, maxIdx:0, count:30, synckey:0 }] };
    if(store._actions?.ACTION_SYNC_BOOK_UNDERLINE_REVIEWS) return store.dispatch('ACTION_SYNC_BOOK_UNDERLINE_REVIEWS', { bookId, chapterUid, range, maxIdx:0, count:30, synckey:0 });
    if(typeof environment.__WRPA__?.sr !== 'function') throw new Error('Native request signature unavailable');
    const signature = await environment.__WRPA__.sr({ body:payload });
    if(signal?.aborted) throw new Error('Request cancelled');
    const response = await environment.fetch('/web/book/readReviews', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json', 'x-wrpa-0':signature }, body:JSON.stringify(payload), signal });
    if(!response.ok) throw new Error('Reading notes unavailable');
    const data = await response.json();
    if(data.errCode) throw new Error('Reading notes unavailable');
    const result = data.reviews?.[0];
    if(!result || !Array.isArray(result.pageReviews)) throw new Error('Invalid reading notes response');
    return result;
  });
  const load = (key, range) => {
    const requestKey = key + ':' + range.start + '-' + range.end;
    if(cache?.key === requestKey) return cache.task;
    cache?.controller.abort();
    const controller = new environment.AbortController();
    const entry = { key:requestKey, controller, task:null, settled:false };
    const payload = { bookId:reader.bookId, chapterUid:reader.currentChapter.chapterUid, range:range.start + '-' + (range.end - 1) };
    let timeout, abort;
    const cancelled = new Promise((resolve, reject) => {
      abort = () => reject(new Error('Reading notes cancelled'));
      controller.signal.addEventListener('abort', abort, {once:true});
      timeout = environment.setTimeout(() => { controller.abort(); }, 8000);
    });
    const request = Promise.resolve().then(() => {
      if(controller.signal.aborted) throw new Error('Reading notes cancelled');
      return fetchReviews(payload, controller.signal);
    });
    entry.task = Promise.race([request, cancelled]).finally(() => {
      entry.settled = true;
      environment.clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abort);
    });
    cache = entry;
    entry.task.catch(() => { if(cache === entry) cache = null; });
    return entry.task;
  };
  const openRange = async value => {
    const range = rangeValue(value), key = chapterKey(), version = reader.renderContentsVersion, token = revision;
    if(!range || !key || !active(key, version, token)) return false;
    const serial = ++requestSerial;
    try {
      const result = await load(key, range);
      if(serial !== requestSerial || !active(key, version, token, range)) return false;
      const reviews = Array.isArray(result?.pageReviews) ? result.pageReviews : [];
      if(!reviews.length) { message('这处划线暂无公开想法'); return true; }
      // Reuse the native pure converter without writing the user's note store.
      const convert = store._modules?.root?._children?.bookReview?._rawModule?.getters?.notes;
      if(typeof convert !== 'function' || typeof reader.showReviewDetailPanel !== 'function') throw new Error('Native notes panel unavailable');
      const state = { ...store.state.bookReview, bookmarks:{ bookmarkList:[], isFetching:false }, noteReviews:{ reviewList:reviews, isFetching:false } };
      const notes = convert(state)?.noteList?.filter(note => note.range && Number.isFinite(note.range.start) && Number.isFinite(note.range.end));
      if(!notes?.length) throw new Error('Native notes conversion unavailable');
      if(serial !== requestSerial || !active(key, version, token, range)) return false;
      releaseNotesScroll();
      const presentation = ++notesSerial;
      reader.showReviewDetailPanel(notes);
      // The official personal-note panel renders Delete for every item. Public
      // thoughts use its original presentation with no mutation callback.
      if(typeof reader.$showReviewDetailPanel === 'function' && reader.$refs?.appContent) {
        reader.$showReviewDetailPanel({parentNode:reader.$refs.appContent,reviewNotes:notes,onHide:()=>{if(presentation===notesSerial){releaseNotesScroll();reader.clearHighLight?.();}},onClickItem:null});
      } else {
        const detail = Object.values(reader.$refs || {}).find(ref => ref?.$options?.name === 'ReaderReviewDetailPanel');
        if(detail) {
          detail.onClickItem = null;
          const originalHide = detail.onHide;
          const hide = (...args) => {if(presentation===notesSerial){releaseNotesScroll();originalHide?.apply(detail,args);}};
          detail.onHide = hide;
          restoreNotesHide = () => {if(detail.onHide === hide) detail.onHide = originalHide;};
        }
      }
      if(typeof reader.$nextTick==='function') await reader.$nextTick();
      if(!disposed && !reader._isDestroyed && presentation === notesSerial) {
        const panel=eventDocument.querySelector?.('.readerReviewDetailPanel_bg');
        if(panel) lockNotesScroll(panel);
        for(const actions of panel?.querySelectorAll('.readerReviewDetail_item > .actions') || []) actions.remove();
        if(panel && !panel.querySelector('.wrp-notes-close') && typeof reader.hideReviewDetailPanel==='function') {
          const close=eventDocument.createElement('button');
          close.className='wrp-notes-close';close.textContent='×';close.type='button';
          close.setAttribute('aria-label','关闭笔记');close.title='关闭笔记';
          close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();reader.hideReviewDetailPanel();});
          panel.prepend(close);
        }
      }
      return true;
    } catch {
      if(serial === requestSerial && active(key, version, token, range)) message('想法暂时无法加载，请稍后再试');
      return false;
    }
  };
  const down = event => { gesture = event.button === 0 ? { x:event.clientX, y:event.clientY, dragged:false } : null; };
  const move = event => { if(gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) gesture.dragged = true; };
  const cancel = () => { gesture = null; };
  const click = event => {
    const start = gesture; gesture = null;
    if(!start || start.dragged || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    if(!active(marksChapter, marksVersion, revision) || !reader.$refs.renderTargetContainer?.contains(event.target)) return;
    const hit = marks.find(mark => {
      if(!mark.element.isConnected) return false;
      const rect = mark.element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom + 2;
    });
    if(!hit) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void openRange(hit.range);
  };
  eventDocument.addEventListener('mousedown', down, true);
  eventDocument.addEventListener('mousemove', move, true);
  eventDocument.addEventListener('click', click, true);
  eventDocument.addEventListener('pointercancel', cancel, true);
  // Reflow invalidates canvas marks, not the lifetime of the visible native
  // notes panel. Its hide callback owns the scroll lock until close/dispose.
  const clear = () => {
    marks = []; marksChapter = null; marksVersion = null; gesture = null; revision++; requestSerial++;
    if(cache && !cache.settled) { cache.controller.abort(); cache = null; }
  };
  return {
    openRange,
    setMarks(entries, key, version) { if(key !== marksChapter) clear(); marks = entries.filter(mark => mark?.element && rangeValue(mark.range)); marksChapter = key; marksVersion = version; },
    clear,
    dispose() {
      if(disposed) return;
      disposed = true; clear(); releaseNotesScroll(); cache?.controller.abort(); cache = null;
      eventDocument.removeEventListener('mousedown', down, true);
      eventDocument.removeEventListener('mousemove', move, true);
      eventDocument.removeEventListener('click', click, true);
      eventDocument.removeEventListener('pointercancel', cancel, true);
    }
  };
};
  // WRP_UNDERLINE_INTERACTION_END
  const underlineInteraction = legacy ? createUnderlineInteraction({reader,store,chapterKey,isEnabled:()=>enabled&&!disposed}) : null;
  const schedule = () => {
    clearTimeout(timer);
    if(!disposed) timer = setTimeout(() => { timer = null; draw().catch(() => {}); }, 60);
  };
  const cancelMetadata = exceptKey => {
    for(const [key, entry] of cache) if(!entry.settled && key !== exceptKey) {
      cache.delete(key); entry.controller.abort();
    }
  };
  const metadata = (key, bookId, chapterUid) => {
    if(cache.has(key)) return cache.get(key).task;
    const now = Date.now();
    for(const [failedKey, at] of failures) if(now - at >= 15000) failures.delete(failedKey);
    if(failures.has(key)) return Promise.resolve(null);
    const controller = new AbortController();
    const entry = {task:null, controller, settled:false};
    let timeout, abort;
    const cancelled = new Promise((resolve, reject) => {
      abort = () => { clearTimeout(timeout); reject(new Error('Underline metadata cancelled')); };
      controller.signal.addEventListener('abort', abort, {once:true});
      timeout = setTimeout(() => { controller.abort(); }, 8000);
    });
    const request = Promise.resolve().then(() => {
      if(controller.signal.aborted) throw new Error('Underline metadata cancelled');
      return fetch('/web/book/underlines?bookId=' + encodeURIComponent(bookId) + '&chapterUid=' + encodeURIComponent(chapterUid), {credentials:'same-origin', signal:controller.signal});
    }).then(async response => {
      if(!response.ok) throw new Error('Underline metadata unavailable');
      const data = await response.json();
      if(!Array.isArray(data.underlines)) throw new Error('Invalid underline metadata');
      return data.underlines;
    });
    entry.task = Promise.race([request, cancelled]).catch(() => {
      if(cache.get(key) === entry) cache.delete(key);
      if(!disposed && !controller.signal.aborted) {
        failures.delete(key); failures.set(key, Date.now());
        while(failures.size > 20) failures.delete(failures.keys().next().value);
      }
      return null;
    }).finally(() => {
      entry.settled = true; clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abort);
    });
    cache.set(key, entry);
    while(cache.size > 20) {
      const oldest = cache.keys().next().value, stale = cache.get(oldest);
      cache.delete(oldest); if(!stale.settled) stale.controller.abort();
    }
    return entry.task;
  };
  const draw = () => {
    if(disposed || reader._isDestroyed || !legacy || typographyBusy) return Promise.resolve();
    cardLayout?.draw();
    if(!enabled) {
      layer?.remove(); layer = null; lastDraw = null; drawRevision++;
      cancelMetadata(); underlineInteraction?.clear();
      return Promise.resolve();
    }
    if(typeof reader.chapterContentState === 'string' && reader.chapterContentState !== 'DONE') return Promise.resolve();
    const target = reader.$refs.renderTargetContainer, key = chapterKey(), version = reader.renderContentsVersion, generation = drawRevision;
    if(!target || !key || !target.isConnected) return Promise.resolve();
    const stamp = key + ':' + version + ':' + generation;
    if(lastDraw === stamp && layer?.parentElement === target) return Promise.resolve();
    if(pendingDraw?.stamp === stamp && pendingDraw.target === target) return pendingDraw.task;
    // In-flight draws of one native version share both metadata and geometry.
    // A chapter transition releases pending requests before replacing marks.
    cancelMetadata(key);
    if(layer?.dataset.wrpChapter !== key) { layer?.remove(); layer = null; underlineInteraction?.clear(); }
    const entry = {stamp, target, task:null};
    entry.task = (async () => {
      const marks = await metadata(key, reader.bookId, reader.currentChapter.chapterUid);
      if(!marks || disposed || !enabled || typographyBusy || reader._isDestroyed || generation !== drawRevision || key !== chapterKey()) return;
      if(typeof reader.chapterContentState === 'string' && reader.chapterContentState !== 'DONE') return;
      if(target !== reader.$refs.renderTargetContainer || !target.isConnected || version !== reader.renderContentsVersion) { schedule(); return; }
      if(lastDraw === stamp && layer?.parentElement === target) return;
      const objects = reader.findObjsWithPoints({x:-1e6,y:-1e6}, {x:1e6,y:1e9});
      if(!objects.length) return;
      const own = (reader.notesListInCurrentChapter || []).map(note => rangeOf(note.range)).filter(Boolean);
      const next = document.createElement('div');
      next.className = 'wrp-popular-underlines'; next.dataset.wrpChapter = key;
      next.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
      let ranges = 0;
      const clickableMarks = [];
      for(const mark of marks) {
        const range = rangeOf(mark.range);
        if(!range || range.end <= range.start) continue;
        let drew = false;
        for(const piece of subtract(range, own)) {
          const selected = reader.findObjsInOffsetRange(objects, piece.start, piece.end);
          for(const rect of reader.getRectsByContentObjs(selected)) {
            if(![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) continue;
            const line = document.createElement('div'); line.className = 'wrp-popular-underline';
            line.style.cssText = 'position:absolute;pointer-events:none;box-sizing:content-box;border-bottom:1px dashed #8c8c8e;left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.w + 'px;height:' + rect.h + 'px;';
            next.appendChild(line); clickableMarks.push({element:line,range}); drew = true;
          }
        }
        if(drew) ranges++;
      }
      next.dataset.wrpRanges = String(ranges); next.dataset.wrpMarks = String(marks.length); next.dataset.wrpRenderVersion = String(version);
      layer?.remove(); target.appendChild(next); layer = next;
      underlineInteraction?.setMarks(clickableMarks,key,version); lastDraw = stamp;
    })().finally(() => { if(pendingDraw === entry) pendingDraw = null; });
    pendingDraw = entry;
    return entry.task;
  };
  const cleanup = () => {
    disposed = true; drawRevision++; pendingDraw = null; cancelMetadata(); cache.clear(); failures.clear();
    document.removeEventListener('keydown',nativeNavigationKey,true);
    if(window.__wrpGetNativeNavigationState===nativeNavigationState)delete window.__wrpGetNativeNavigationState;
    clearTimeout(timer);
    for(const stop of watches) stop();
    layer?.remove(); layer = null;
    underlineInteraction?.dispose();
    fontStyle?.remove(); fontStyle = null;
    lineStyle?.remove(); lineStyle = null;
    paragraphStyle?.remove(); paragraphStyle = null;
    cardLayout?.dispose();
    literatureStyle?.remove(); literatureStyle = null;
    document.body.classList.remove('wrp-literature-mode');
    if(collectWithCards && reader.collectPreRenderInfos === collectWithCards) reader.collectPreRenderInfos = originalCollect;
  };
  if(legacy) {
    watches.push(reader.$watch(() => reader.renderContentsVersion, schedule));
    watches.push(reader.$watch(() => reader.chapterContentState, schedule));
    watches.push(reader.$watch(() => chapterKey(), schedule));
    watches.push(reader.$watch(() => reader.notesListInCurrentChapter, () => { lastDraw = null; drawRevision++; schedule(); }, { deep: true }));

  }
  let navigationSequence=0, navigationAccepted=false, navigationPending=false, navigationResult=null, navigationError=null;
  const nativeNavigationState=()=>{
    if(disposed||reader._isDestroyed) return null;
    const supported=typeof reader.handlePrevChapter==='function'&&typeof reader.handleNextChapter==='function'&&typeof reader.getChapterWithIdxOffset==='function';
    const ready=reader.currentChapter?.chapterUid!=null&&(reader.chapterContentState==null||reader.chapterContentState==='DONE');
    let previous=false,next=false;
    if(supported&&ready) {try {previous=!!reader.getChapterWithIdxOffset(-1);next=!!reader.getChapterWithIdxOffset(1);} catch (_) {}}
    return {supported,ready,previous,next,chapterUid:reader.currentChapter?.chapterUid,sequence:navigationSequence,accepted:navigationAccepted,pending:navigationPending,result:navigationResult,error:navigationError};
  };
  const nativeNavigationKey=event=>{
    if(!event.isTrusted||!event.ctrlKey||!event.altKey||!event.shiftKey||event.metaKey||!['F13','F14'].includes(event.key)) return;
    const state=nativeNavigationState();
    if(!state?.supported||!state.ready) return;
    event.preventDefault();event.stopImmediatePropagation();navigationSequence++;navigationAccepted=false;navigationPending=false;navigationResult=null;navigationError=null;
    const direction=event.key==='F13'?-1:1;
    if(!(direction<0?state.previous:state.next)) return;
    // The native handler receives the original trusted keyboard event. Its
    // access checks, chapter loading and progress updates remain in charge.
    try {
      const result=reader[direction<0?'handlePrevChapter':'handleNextChapter'](event);
      navigationAccepted=true;
      if(result&&typeof result.then==='function') {
        const sequence=navigationSequence;
        navigationPending=true;
        Promise.resolve(result).then(value=>{if(sequence===navigationSequence){navigationResult=value==null?null:{success:value.success??null,reason:value.reason??null};navigationPending=false;}},error=>{if(sequence===navigationSequence){navigationError=String(error?.message||error);navigationPending=false;}});
      }
    } catch (error) { navigationError=String(error?.message||error); }
  };
  window.__wrpGetNativeNavigationState=nativeNavigationState;
  document.addEventListener('keydown',nativeNavigationKey,true);
  const nativeFontSizes = [18, 21, 24, 28, 32, 36, 42];
  const smallFontSizes = [10, 12, 14, 16];
  let fontStyle = null, lineStyle = null, paragraphStyle = null, lineHeight = 1.9, paragraphSpacing = 0;
  let restoreFontPx = null, restoreLineHeight = null, fontPreferenceSeen = false, linePreferenceSeen = false;
  let restoreParagraphSpacing = null, paragraphPreferenceSeen = false, preferenceKey = null;
  let contentWidth = null, pendingReflow = false, typographyBusy = false;
  const validLineHeight = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 3;
  const validParagraphSpacing = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 80;
  const fontState = () => {
    if(disposed || reader._isDestroyed || typeof reader.changeFontSize !== 'function') return null;
    const level = Number(reader.fontSizeLevel);
    const custom = Number(fontStyle?.dataset.wrpFontSize);
    return { level, size: level === 1 && smallFontSizes.includes(custom) ? custom : nativeFontSizes[level - 1], lineHeight, paragraphSpacing, preferenceKey, count: nativeFontSizes.length, ready: !typographyBusy && reader.chapterContentState === 'DONE' };
  };
  const applyFontOverride = size => {
    if(!smallFontSizes.includes(size)) { fontStyle?.remove(); fontStyle = null; return; }
    if(!fontStyle) {
      fontStyle = document.createElement('style');
      fontStyle.id = 'weread-pocket-font-size';
      (document.head || document.documentElement).appendChild(fontStyle);
    }
    fontStyle.dataset.wrpFontSize = String(size);
    // Native collection reads these computed fonts before drawing canvases.
    // Recollect even at the same native level so underline geometry follows.
    fontStyle.textContent = '.wr_page_reader .readerChapterContent.fontLevel1{font-size:' + size + 'px!important}.wr_page_reader .readerChapterContent.fontLevel1 .preRenderContainer .preRenderContent p,.wr_page_reader .readerChapterContent.fontLevel1 .renderTargetContent p{font-size:' + size + 'px!important;line-height:' + (Math.round(size * lineHeight * 1000) / 1000) + 'px!important}';
  };
  const applyLineHeight = value => {
    lineHeight = value;
    if(!lineStyle) {
      lineStyle = document.createElement('style');
      lineStyle.id = 'weread-pocket-line-height';
      (document.head || document.documentElement).appendChild(lineStyle);
    }
    lineStyle.dataset.wrpLineHeight = String(value);
    lineStyle.textContent = '.wr_page_reader .readerChapterContent[class*="fontLevel"] .preRenderContainer .preRenderContent p,.wr_page_reader .readerChapterContent[class*="fontLevel"] .renderTargetContent p{line-height:' + value + '!important}';
  };
  window.__wrpGetFontState = fontState;
  const applyParagraphSpacing = value => {
    paragraphSpacing = value;
    if(!paragraphStyle) {
      paragraphStyle = document.createElement('style'); paragraphStyle.id = 'weread-pocket-paragraph-spacing';
      (document.head || document.documentElement).appendChild(paragraphStyle);
    }
    paragraphStyle.dataset.wrpParagraphSpacing = String(value);
    // Replace native paragraph spacing before collecting canvas geometry.
    // Keep all vertical spacing in padding so it cannot collapse with margins.
    paragraphStyle.textContent = '.wr_page_reader .readerChapterContent[class*="fontLevel"] .preRenderContainer .preRenderContent p,.wr_page_reader .readerChapterContent[class*="fontLevel"] .renderTargetContent p{margin-top:0!important;margin-bottom:0!important;padding-top:0!important;padding-bottom:' + value + 'px!important}';
  };
  const setTypography = async (size, spacing, force = false, paragraphs = null) => {
    const before = fontState();
    if(!before?.ready || ![...smallFontSizes, ...nativeFontSizes].includes(size) || (spacing != null && !validLineHeight(spacing)) || (paragraphs != null && !validParagraphSpacing(paragraphs))) return false;
    const level = smallFontSizes.includes(size) ? 1 : nativeFontSizes.indexOf(size) + 1;
    if(!force && before.size === size && before.level === level && (spacing == null || (spacing === lineHeight && lineStyle)) && (paragraphs == null || (paragraphs === paragraphSpacing && paragraphStyle))) return true;
    const previousOverride = Number(fontStyle?.dataset.wrpFontSize);
    const previousLineHeight = lineHeight, previousLineApplied = !!lineStyle;
    const previousParagraphSpacing = paragraphSpacing, previousParagraphApplied = !!paragraphStyle;
    typographyBusy = true;
    try {
      if(spacing != null) applyLineHeight(spacing);
      if(paragraphs != null) applyParagraphSpacing(paragraphs);
      applyFontOverride(size);
      layer?.remove(); layer = null; lastDraw = null; drawRevision++;
      underlineInteraction?.clear();
      try { await Promise.resolve(reader.changeFontSize(level)); }
      catch {
        if(disposed || reader._isDestroyed) return false;
        lineHeight = previousLineHeight;
        if(previousLineApplied) applyLineHeight(previousLineHeight);
        else { lineStyle?.remove(); lineStyle = null; }
        paragraphSpacing = previousParagraphSpacing;
        if(previousParagraphApplied) applyParagraphSpacing(previousParagraphSpacing);
        else { paragraphStyle?.remove(); paragraphStyle = null; }
        applyFontOverride(previousOverride);
        try { await Promise.resolve(reader.changeFontSize(before.level)); } catch { /* Keep the last font preference for recovery. */ }
        return false;
      }
      return !disposed && !reader._isDestroyed;
    } finally {
      typographyBusy = false;
      if(!disposed && !reader._isDestroyed) { restoreTypography(); if(!typographyBusy && reader.chapterContentState === 'DONE') schedule(); }
    }
  };
  window.__wrpSetFontSize = size => {
    const before = fontState();
    if(!before?.ready || ![...smallFontSizes, ...nativeFontSizes].includes(size)) return Promise.resolve(false);
    fontPreferenceSeen = true; restoreFontPx = null;
    return setTypography(size, null);
  };
  window.__wrpSetLineHeight = value => {
    const before = fontState();
    if(!before?.ready || !validLineHeight(value)) return Promise.resolve(false);
    linePreferenceSeen = true; restoreLineHeight = null;
    return setTypography(before.size, value);
  };
  window.__wrpSetParagraphSpacing = value => {
    const before = fontState();
    if(!before?.ready || !validParagraphSpacing(value)) return Promise.resolve(false);
    paragraphPreferenceSeen = true; restoreParagraphSpacing = null;
    return setTypography(before.size, null, false, value);
  };
  const restoreTypography = () => {
    if((restoreFontPx == null && restoreLineHeight == null && restoreParagraphSpacing == null && !pendingReflow) || reader.chapterContentState !== 'DONE' || disposed || typographyBusy) return;
    const size = restoreFontPx ?? fontState()?.size, spacing = restoreLineHeight, force = pendingReflow, paragraphs = restoreParagraphSpacing;
    restoreFontPx = null; restoreLineHeight = null; restoreParagraphSpacing = null; pendingReflow = false;
    const requestedKey = preferenceKey;
    setTypography(size, spacing, force, paragraphs).then(ok => {
      if(!ok && requestedKey != null && preferenceKey === requestedKey && !disposed) preferenceKey = null;
    }).catch(() => {});
  };
  window.__wrpSetLiteratureAppearance = (config, deferReflow = false) => {
    if(disposed || reader._isDestroyed) return false;
    if(!originalCollect) return !config?.enabled;
    const candidate=config?.dockBounds;
    const dockBounds=Number.isFinite(candidate?.left)&&Number.isFinite(candidate?.right)&&candidate.left>=0&&candidate.right-candidate.left>=80&&candidate.right<=window.innerWidth ? {left:candidate.left,right:candidate.right} : null;
    const next = { enabled: !!config?.enabled, english: String(config?.english || '').slice(0, 12000).replace(/\r\n?/g, '\n'), paragraphs: Math.max(1, Math.min(6, Math.round(Number(config?.paragraphs) || 3))), fontFamily:String(config?.fontFamily || 'sans-serif').replace(/[{};\r\n<>]/g,'').slice(0,500),dockBounds };
    if(JSON.stringify(next) === JSON.stringify(literature)) return true;
    const needsReflow = literature.enabled || next.enabled;
    literature = next;
    cardLayout?.clear();
    if(next.enabled) {
      if(!literatureStyle) { literatureStyle=document.createElement('style');literatureStyle.id='weread-pocket-literature-typography';(document.head||document.documentElement).appendChild(literatureStyle); }
      literatureStyle.textContent='.wr_page_reader.wrp-literature-mode .preRenderContent p,.wr_page_reader.wrp-literature-mode .renderTargetContent p{font-family:'+next.fontFamily+'!important;font-weight:400!important;text-indent:0!important;text-align:left!important;letter-spacing:normal!important;word-spacing:normal!important}.wr_page_reader.wrp-literature-mode .preRenderContent p *,.wr_page_reader.wrp-literature-mode .renderTargetContent p *{font-family:inherit!important}';
      if(next.dockBounds) literatureStyle.textContent+='.wr_page_reader.wrp-literature-mode .readerChapterContent{padding-left:'+next.dockBounds.left+'px!important;padding-right:max(0px,calc(100% - '+next.dockBounds.right+'px))!important}';
    } else { literatureStyle?.remove();literatureStyle=null; }
    document.body.classList.toggle('wrp-literature-mode', literature.enabled);
    if(needsReflow) { pendingReflow = true; if(!deferReflow) restoreTypography(); }
    return true;
  };
  if(typeof reader.changeFontSize === 'function') watches.push(reader.$watch(() => reader.chapterContentState, restoreTypography));
  reader.$once('hook:beforeDestroy', cleanup);
  let desiredTheme = null;
  window.__wrpApplyNativeTheme = async theme => {
    if(disposed || reader._isDestroyed || !['dark', 'light'].includes(theme) || !store._actions?.toggleTheme) return false;
    desiredTheme = theme;
    const isWhite = theme === 'light';
    if(store.state.isWhiteTheme !== isWhite) await store.dispatch('toggleTheme', { isWhite, modifyCookie: false });
    await reader.$nextTick();
    return !disposed && !reader._isDestroyed && store.state.isWhiteTheme === isWhite && document.body.classList.contains('wr_whiteTheme') === isWhite;
  };
  if(store._actions?.toggleTheme) watches.push(reader.$watch(() => reader.isWhiteTheme, () => {
    if(desiredTheme && !disposed && store.state.isWhiteTheme !== (desiredTheme === 'light')) window.__wrpApplyNativeTheme(desiredTheme).catch(() => {});
  }));
  window.__wrpSetReadingFlow = flow => {
    if(disposed || reader._isDestroyed || !union || typeof union.handleSwitchMode !== 'function' || !['continuous','scroll','paged'].includes(flow) || typographyBusy || (reader.chapterContentState != null && reader.chapterContentState !== 'DONE')) return false;
    const horizontal = !!document.querySelector('.wr_horizontalReader');
    if(horizontal !== (flow === 'paged')) union.handleSwitchMode(flow === 'paged');
    return true;
  };
  window.__wrpApplyNativePadding = (value, pocket, showPopular, preferredFontPx, preferredLineHeight, preferredParagraphSpacing, profileKey) => {
    if(reader._isDestroyed || disposed) return false;
    if(typeof profileKey === 'string' && profileKey !== preferenceKey) {
      preferenceKey = profileKey;
      fontPreferenceSeen = true; linePreferenceSeen = true; paragraphPreferenceSeen = true;
      restoreFontPx = [...smallFontSizes, ...nativeFontSizes].includes(preferredFontPx) ? preferredFontPx : null;
      restoreLineHeight = validLineHeight(preferredLineHeight) ? preferredLineHeight : null;
      restoreParagraphSpacing = validParagraphSpacing(preferredParagraphSpacing) ? preferredParagraphSpacing : null;
    }
    if(!fontPreferenceSeen) {
      fontPreferenceSeen = true;
      if(smallFontSizes.includes(preferredFontPx)) restoreFontPx = preferredFontPx;
    }
    if(!linePreferenceSeen && validLineHeight(preferredLineHeight)) { linePreferenceSeen = true; restoreLineHeight = preferredLineHeight; }
    if(!paragraphPreferenceSeen && validParagraphSpacing(preferredParagraphSpacing)) { paragraphPreferenceSeen = true; restoreParagraphSpacing = preferredParagraphSpacing; }
    if(legacy && typeof reader.changeFontSize === 'function') {
      const width = reader.$refs.renderTargetContainer?.clientWidth;
      if(width > 0) {
        // The legacy resize handler caches viewport width, which does not
        // change when only our gutters do. Recollect actual content width.
        if(contentWidth != null && contentWidth !== width) pendingReflow = true;
        contentWidth = width;
      }
    }
    restoreTypography();
    if(legacy) {
      if(enabled !== !!showPopular) { lastDraw = null; drawRevision++; if(!showPopular) cancelMetadata(); }
      enabled = !!showPopular;
      schedule();
      return true;
    }
    const chapter = document.querySelector('.wr_horizontalReader .readerChapterContent');
    if(!chapter || !render || !store._actions?.modifyCanvasOptions) return false;
    const width = chapter.clientWidth;
    if(width <= 0) return false;
    const between = Number(render.canvasXBetween) || 50;
    const limit = window.innerWidth < 1060 ? (width - 240) / 2 : width / 2 - between - 240;
    const padding = Math.max(4, Math.min(value, Math.max(4, Math.floor(limit))));
    const viewport = chapter.getBoundingClientRect();
    const boxes = selector => [...document.querySelectorAll(selector)].map(node => node.getBoundingClientRect());
    const insets = nativePagedInsets(viewport,
      boxes('.wr_horizontalReader .renderTargetPageInfo_header'),
      boxes('.wr_horizontalReader .renderTarget_pager_button'));
    if(!insets) return false;
    const {canvasTop, canvasBottom} = insets;
    if(render.canvasXAround !== padding || render.canvasTop !== canvasTop || render.canvasBottom !== canvasBottom) {
      store.dispatch('modifyCanvasOptions', { canvasXAround: padding, canvasTop, canvasBottom }).then(() => { if(!disposed && !reader._isDestroyed) window.dispatchEvent(new Event('resize')); }).catch(() => {});
    }
    return true;
  };
  return true;
}
