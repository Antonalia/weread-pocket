(function createLocalBookSearch(options = {}) {
  const maxResults = Math.max(1, Math.min(500, Math.floor(Number(options.maxResults) || 200)));
  const maxQuery = 256, context = 64;
  let revision = 0, disposed = false;
  const notify = (name, value) => { try { options[name]?.(value); } catch (_) { /* Closing a results view cannot interrupt a read. */ } };
  const yieldTask = options.yieldTask || (() => new Promise(resolve => setTimeout(resolve, 0)));
  const cancel = () => { revision++; };
  const search = async raw => {
    const token = ++revision, book = options.getBook?.(), query = String(raw || '').replace(/\s+/g,' ').trim().slice(0, maxQuery);
    const results = [], failures = [];
    let processed = 0, failedChapters = 0, truncated = false;
    const total = Array.isArray(book?.chapters) ? book.chapters.length : 0;
    const current = () => !disposed && token === revision && options.getBook?.() === book && options.isCurrent?.() !== false;
    const state = done => ({query, processed, total, count:results.length, failedChapters, truncated, done});
    if (!query || !total || typeof book.readChapter !== 'function' || typeof options.extractParagraphs !== 'function') return {...state(true), results, failures, canceled:false};
    const pattern = new RegExp(query.replace(/[\^$.*+?()[\]{}|\\]/g, character => '\\' + character), 'giu');
    if(!current()) return {...state(false), results:[], failures:[], canceled:true};
    notify('onProgress', state(false));
    for (let chapter = 0; chapter < total; chapter++) {
      if (!current()) return {...state(false), results:[], failures:[], canceled:true};
      // A payload and its extracted strings are confined to one iteration. Only
      // bounded context snippets enter the result list; no full-book index lives here.
      const beforeCount=results.length;
      try {
        const payload = await book.readChapter(chapter);
        if (!current()) return {...state(false), results:[], failures:[], canceled:true};
        const paragraphs = await options.extractParagraphs(payload, chapter, book);
        if (!current()) return {...state(false), results:[], failures:[], canceled:true};
        if (!Array.isArray(paragraphs)) throw new Error('章节文字无法识别');
        for (let paragraph = 0; paragraph < paragraphs.length && results.length < maxResults; paragraph++) {
          const value = String(paragraphs[paragraph] ?? '');pattern.lastIndex=0;let match;
          while (results.length < maxResults && (match = pattern.exec(value))) {
            const start=match.index, end=start+match[0].length;
            results.push({chapter, paragraph, matchStart:start, matchLength:match[0].length,
              before:(start > context ? '…' : '') + value.slice(Math.max(0, start - context), start),
              match:match[0], after:value.slice(end, end + context) + (end + context < value.length ? '…' : '')});
          }
        }
      } catch (error) {
        if (!current()) return {...state(false), results:[], failures:[], canceled:true};
        failedChapters++;
        if (failures.length < 20) failures.push({chapter, message:String(error?.message || '章节读取失败').slice(0, 160)});
      }
      processed = chapter + 1;
      if (results.length >= maxResults) truncated = true;
      if(results.length!==beforeCount)notify('onResults', results.slice());
      notify('onProgress', state(false));
      if (truncated) break;
      await yieldTask();
    }
    if (!current()) return {...state(false), results:[], failures:[], canceled:true};
    const result = {...state(true), results, failures, canceled:false};
    notify('onProgress', state(true));
    return result;
  };
  return {search, cancel, destroy(){disposed = true;cancel();}, get maxResults(){return maxResults;}};
})
