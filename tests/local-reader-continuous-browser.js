(async function validateContinuousLocalReader(options) {
  const {document, factory, css} = options;
  const {Event, WheelEvent} = document.defaultView;
  const style = document.createElement('style'); style.textContent = css;
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-20000px;top:0;width:429.5px;height:320px;display:flex;visibility:hidden;';
  document.head.append(style); document.body.append(host);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms || 60));
  const checks = [], errors = [], progressEvents = [], reads = [], chapterEvents = [];
  const assert = (name, pass, details) => { checks.push({name,pass:!!pass,...(details?{details}:{})}); if (!pass) throw new Error(name); };
  const api = factory({host,document,onProgress:value=>progressEvents.push(value),onChapter:index=>chapterEvents.push(index),onError:message=>errors.push(message)});
  const scroll = api.root.querySelector('.wrp-local-scroll');
  const top = node => node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
  const record = index => api.root.querySelector('[data-wrp-chapter="' + index + '"]');
  const paragraph = (index, number) => record(index)?.querySelector('[data-wrp-paragraph="' + number + '"]');
  const config = {fontSize:16,lineHeight:1.5,paragraphSpacing:3,contentPadding:12,continuousChapters:true,readingFlow:'scroll',literature:{enabled:false}};
  const until = async test => { for (let i=0;i<30;i++) { if (test()) { await pause(); return; } await pause(); } throw new Error('background chapter window did not settle'); };
  const settle = () => until(() => api.stats.pendingChapterReads === 0);
  const positioned = async (index, number=8, offset=.35) => {
    const node = paragraph(index,number); if (!node) throw new Error('chapter not mounted: ' + index);
    scroll.scrollTop = top(node) + node.getBoundingClientRect().height * offset;
    scroll.dispatchEvent(new Event('scroll')); api.captureProgress(); await settle();
  };
  const chapters = Array.from({length:8},(_,i)=>({title:'验证章节 ' + (i+1),href:'Text/Part'+i+'/body.xhtml'}));
  const book = {id:'synthetic-continuous-book',title:'Synthetic continuous reader',format:'epub',chapters,
    navigation:chapters.map((item,index)=>({title:item.title,chapterIndex:index,anchor:'note'})),
    async readChapter(index) {
      reads.push(index);
      const paragraphs = Array.from({length:23+index*3},(_,number)=>'<p id="'+(number===8?'note':'p'+number)+'">Synthetic paragraph '+number+': continuous chapter reading preserves the original position. 本地章节接在一起阅读，使用现有排版与窗口设置。'+(number%4===0?' Additional variable-height content keeps a meaningful anchor. 更多长度用于验证排版。':'')+'</p>').join('');
      return {href:chapters[index].href,html:'<h1 id="chapter-heading">'+chapters[index].title+'</h1>'+paragraphs+(index===5?'<p><a href="../Part6/body.xhtml#note">Source-relative local note</a></p>':'')};
    }};
  let report;
  try {
    api.applyAppearance(config);
    assert('continuous current chapter opens immediately', await api.setBook(book)); await settle();
    assert('initial window mounts current and next only', api.stats.chapterIndexes.join(',') === '0,1' && reads.length === 2,api.stats);
    assert('continuous mode removes previous and next chapter buttons', !api.root.querySelector('.wrp-local-chapter-button'));
    assert('ordinary chapters retain visible generated headings', [...api.root.querySelectorAll('.wrp-local-chapter-title')].length === api.stats.renderedChapters && document.defaultView.getComputedStyle(api.root.querySelector('.wrp-local-chapter-title')).display !== 'none');
    const wheel = new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}); scroll.dispatchEvent(wheel);
    assert('continuous wheel keeps native scrolling', !wheel.defaultPrevented);
    await positioned(1);
    assert('visible chapter determines chapter-local progress', api.chapter===1 && api.captureProgress().chapter===1 && api.captureProgress().paragraph===8,api.captureProgress());
    assert('following chapter extends lazily to three records', api.stats.chapterIndexes.join(',')==='0,1,2' && api.stats.renderedChapters===3,api.stats);
    const anchor = paragraph(2,8); scroll.scrollTop=top(anchor)+anchor.getBoundingClientRect().height*.3;
    const beforeAppend=anchor.getBoundingClientRect().top; scroll.dispatchEvent(new Event('scroll')); await settle();
    assert('forward prune and append keep paragraph coordinate', api.stats.chapterIndexes.join(',')==='1,2,3' && Math.abs(anchor.getBoundingClientRect().top-beforeAppend)<1,{stats:api.stats,shift:anchor.getBoundingClientRect().top-beforeAppend});
    await positioned(1);
    const backAnchor=paragraph(1,8),backTop=backAnchor.getBoundingClientRect().top;
    await settle();
    assert('backward prepend and prune preserve paragraph position', api.stats.chapterIndexes.join(',')==='0,1,2' && Math.abs(backAnchor.getBoundingClientRect().top-backTop)<1,api.stats);
    await positioned(2,10,.4);
    const beforeType=api.captureProgress();
    api.applyAppearance({...config,fontSize:22,lineHeight:1.8});
    api.applyAppearance({...config,fontSize:19,lineHeight:1.4,paragraphSpacing:1});
    host.style.width='380px'; await settle();
    const afterType=api.captureProgress();
    assert('rapid typography and resize retain chapter and paragraph anchor', beforeType.chapter===afterType.chapter && beforeType.paragraph===afterType.paragraph && Math.abs(beforeType.offset-afterType.offset)<.08,{before:beforeType,after:afterType});
    const beforeDisable=api.captureProgress();
    api.applyAppearance({...config,continuousChapters:false}); await settle();
    const afterDisable=api.captureProgress();
    assert('disabling continuous mode returns to one chapter and compact buttons', api.stats.renderedChapters===1 && !!api.root.querySelector('.wrp-local-chapter-button') && beforeDisable.chapter===afterDisable.chapter && beforeDisable.paragraph===afterDisable.paragraph,api.stats);
    api.applyAppearance(config); await settle();
    assert('re-enabling continuous mode keeps current paragraph', api.captureProgress().chapter===beforeDisable.chapter && api.captureProgress().paragraph===beforeDisable.paragraph && api.stats.renderedChapters===3);
    const literature={enabled:true,english:'A synthetic reference quotation.\n\nSecond quotation for consistent spacing.',paragraphs:2,dockBounds:{left:9,right:scroll.getBoundingClientRect().width-15}};
    api.applyAppearance({...config,readingFlow:'paged',literature}); await settle();
    assert('literature mode remains continuous despite paged preference', api.stats.continuous && api.root.dataset.wrpReadingFlow==='scroll' && !api.root.querySelector('.wrp-local-chapter-button'));
    assert('continuous literature cards omit novel chapter headings', !api.root.querySelector('.wrp-local-chapter-title'));
    await api.navigate(2,'chapter-heading'); await settle();
    assert('literature chapter heading anchors still navigate correctly', api.chapter===2 && api.captureProgress().chapter===2 && record(2).querySelector('[data-wrp-anchor="chapter-heading"]') && record(2).querySelector('.wrp-local-title-anchors').getBoundingClientRect().height===0, api.captureProgress());
    api.applyAppearance({...config,continuousChapters:false,literature}); await settle();
    assert('singlechapter literature cards also omit novel headings', api.stats.renderedChapters===1 && !api.root.querySelector('.wrp-local-chapter-title'));
    api.applyAppearance({...config,literature}); await settle();
    const colorsBefore=[...record(2).querySelectorAll('.wrp-local-card')].map(card=>card.style.getPropertyValue('--wrp-local-card-accent'));
    api.applyAppearance({...config,readingFlow:'scroll',fontSize:18,literature}); await settle();
    const colorsAfter=[...record(2).querySelectorAll('.wrp-local-card')].map(card=>card.style.getPropertyValue('--wrp-local-card-accent'));
    assert('chapter card colors are stable across layout changes', JSON.stringify(colorsBefore)===JSON.stringify(colorsAfter) && new Set(colorsAfter).size===5);
    const cards=[...api.root.querySelectorAll('.wrp-local-card')],lefts=cards.map(card=>card.getBoundingClientRect().left),rights=cards.map(card=>card.getBoundingClientRect().right);
    assert('all continuous chapter card borders align at fractional width', Math.max(...lefts)-Math.min(...lefts)<.05 && Math.max(...rights)-Math.min(...rights)<.05);
    api.applyAppearance(config); await settle(); assert('returning to ordinary reading restores chapter headings', !!api.root.querySelector('.wrp-local-chapter-title') && document.defaultView.getComputedStyle(api.root.querySelector('.wrp-local-chapter-title')).display !== 'none'); await api.navigate(4); await settle();
    const neighborLink=record(5).querySelector('[data-wrp-local-href]'); neighborLink.click(); await settle();
    assert('link resolves relative to its own adjacent chapter', api.chapter===6 && api.captureProgress().paragraph===8 && api.root.querySelector('[data-wrp-chapter="6"] [data-wrp-anchor="note"]'),api.captureProgress());
    api.openCatalog(); api.root.querySelector('.wrp-local-catalog-item').click(); await settle();
    assert('catalog jump reuses bounded window and chapter anchor', api.chapter===0 && api.captureProgress().paragraph===8 && api.stats.chapterIndexes.join(',')==='0,1',api.stats);
    const visited=[];
    for(let index=1;index<chapters.length;index++){await positioned(index,10,.2);visited.push(api.captureProgress().chapter);assert('chapter '+index+' stays inside three-record memory bound', api.stats.renderedChapters<=3 && api.stats.maxRenderedChapters<=3);}
    scroll.scrollTop=scroll.scrollHeight;scroll.dispatchEvent(new Event('scroll'));await settle();
    assert('native scrolling traverses all chapters to book end', visited.join(',')==='1,2,3,4,5,6,7' && api.captureProgress().percent===100 && !api.root.querySelector('.wrp-local-chapter-button'),api.captureProgress());
    let releaseSlow;
    const slow={...book,id:'slow-synthetic',readChapter:async index=>index===4?new Promise(resolve=>{releaseSlow=()=>resolve({href:chapters[4].href,html:'<p>Obsolete synthetic adjacent content</p>'});}):book.readChapter(index)};
    await api.setBook(slow,{chapter:3,paragraph:8,offset:.2});await until(()=>!!releaseSlow);
    await api.navigate(0);releaseSlow();await settle();
    assert('obsolete adjacent loading cannot replace catalog destination', api.chapter===0 && !record(4) && !api.root.textContent.includes('Obsolete synthetic'));
    let releaseOld;
    const old={...book,id:'old-synthetic',readChapter:async index=>index===1?new Promise(resolve=>{releaseOld=()=>resolve({href:chapters[1].href,html:'<p>Obsolete prior book content</p>'});}):book.readChapter(index)};
    await api.setBook(old);await until(()=>!!releaseOld);
    await api.setBook(book,{chapter:5,paragraph:9,offset:.2});releaseOld();await settle();
    assert('book switch cancels previous book chapter reads', api.book===book && api.captureProgress().chapter===5 && !api.root.textContent.includes('Obsolete prior book'));
    api.applyAppearance({...config,readingFlow:'paged'});await settle();
    const pagedWheel=new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true});scroll.dispatchEvent(pagedWheel);
    assert('paged mode uses one chapter and existing wheel step behavior', !api.stats.continuous && api.stats.renderedChapters===1 && pagedWheel.defaultPrevented);
    api.destroy(); assert('destroy discards all rendered chapters and resources', api.stats.renderedChapters===0 && api.stats.imageBytes===0 && !api.book && !api.root.isConnected);
    report={version:'0.4.0',runtime:'Obsidian desktop',passed:true,checks,chapterReads:reads.length,progressEvents:progressEvents.length,chapterEvents:chapterEvents.length,errors};
  }catch(error){report={version:'0.4.0',runtime:'Obsidian desktop',passed:false,error:error.message,checks,stats:api.stats};}
  finally{api.destroy();host.remove();style.remove();}
  report.cleanup={hostRemoved:!host.isConnected,styleRemoved:!style.isConnected,surfaceRemoved:!api.root.isConnected};
  return report;
})
