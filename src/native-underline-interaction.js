function createNativeUnderlineInteraction({ reader, store, chapterKey, isEnabled, requestReviews = null, eventDocument = document, environment = window }) {
  let disposed = false, marks = [], marksChapter = null, marksVersion = null, gesture = null, revision = 0, requestSerial = 0, cache = null;
  let notesPanel = null, notesRoot = null, restoreNotesHide = null;
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
    const entry = { key:requestKey, controller, task:null };
    let timeout;
    const deadline = new Promise((resolve, reject) => { timeout = environment.setTimeout(() => { controller.abort(); reject(new Error('Reading notes timeout')); }, 8000); });
    const request = Promise.resolve().then(() => fetchReviews({ bookId:reader.bookId, chapterUid:reader.currentChapter.chapterUid, range:range.start + '-' + (range.end - 1) }, controller.signal));
    entry.task = Promise.race([request, deadline]).finally(() => environment.clearTimeout(timeout));
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
      reader.showReviewDetailPanel(notes);
      // The official personal-note panel renders Delete for every item. Public
      // thoughts use its original presentation with no mutation callback.
      if(typeof reader.$showReviewDetailPanel === 'function' && reader.$refs?.appContent) {
        reader.$showReviewDetailPanel({parentNode:reader.$refs.appContent,reviewNotes:notes,onHide:()=>{releaseNotesScroll();reader.clearHighLight?.();},onClickItem:null});
      } else {
        const detail = Object.values(reader.$refs || {}).find(ref => ref?.$options?.name === 'ReaderReviewDetailPanel');
        if(detail) {
          detail.onClickItem = null;
          const originalHide = detail.onHide;
          const hide = (...args) => {releaseNotesScroll();originalHide?.apply(detail,args);};
          detail.onHide = hide;
          restoreNotesHide = () => {if(detail.onHide === hide) detail.onHide = originalHide;};
        }
      }
      if(typeof reader.$nextTick==='function') await reader.$nextTick();
      if(active(key,version,token,range) && serial===requestSerial) {
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
  const clear = () => { releaseNotesScroll(); marks = []; marksChapter = null; marksVersion = null; gesture = null; revision++; requestSerial++; };
  return {
    openRange,
    setMarks(entries, key, version) { if(key !== marksChapter) clear(); marks = entries.filter(mark => mark?.element && rangeValue(mark.range)); marksChapter = key; marksVersion = version; },
    clear,
    dispose() {
      if(disposed) return;
      disposed = true; clear(); cache?.controller.abort(); cache = null;
      eventDocument.removeEventListener('mousedown', down, true);
      eventDocument.removeEventListener('mousemove', move, true);
      eventDocument.removeEventListener('click', click, true);
      eventDocument.removeEventListener('pointercancel', cancel, true);
    }
  };
}
