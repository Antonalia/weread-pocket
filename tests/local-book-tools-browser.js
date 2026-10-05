(async function validateLocalBookTools(options) {
  const {document,factory,searchFactory,installIntegration,readerCss,toolsCss}=options,view=document.defaultView;
  const checks=[],assert=(name,passed,details)=>{checks.push({name,passed:!!passed,...details?{details}:{}});if(!passed)throw Error(name);};
  const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
  const style=document.createElement('style');style.textContent=readerCss+'\n'+toolsCss;document.head.append(style);
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:380px;height:320px;display:flex;visibility:hidden;';document.body.append(host);
  const modals=[];
  class FixtureModal {
    constructor(){this.modalEl=document.createElement('div');this.modalEl.style.cssText='position:fixed;left:-20000px;top:0;visibility:hidden;width:300px;';this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);modals.push(this);}
    open(){document.body.append(this.modalEl);this.onOpen?.();}
    close(){this.onClose?.();this.modalEl.remove();}
  }
  class Pocket {}
  for(const match of installIntegration.toString().matchAll(/wrap\('([^']+)'/g))Pocket.prototype[match[1]]=function(){};
  installIntegration(Pocket,{Modal:FixtureModal,Notice:class {},createLocalBookSearch:searchFactory,createLocalBookStore:()=>({})});
  const reader=factory({document,host}),p=new Pocket();
  const chapters=[{title:'第一章',href:'one.xhtml'},{title:'第二章',href:'two.xhtml'}];
  const html=['<h2>第一章</h2><p>　　开场文字。</p><p>before <strong>needle</strong> after。</p><p><img src="Images/unused.png" alt="ONLY_IMAGE_METADATA_TOKEN"></p><p>CaptionOnlyText：真实图注。</p>'+Array.from({length:30},()=>'<p>填充段落不包含查询。</p>').join(''), '<h2>第二章</h2><p>中文命中 <em>needle</em> 结束。</p><p>'+('long paragraph text '.repeat(180))+'needle 最后命中。</p>'];
  const book={id:'local-tools-fixture',title:'合成本地图书',chapters,async readChapter(index){return {html:html[index],href:chapters[index].href};}};
  p.settings={readingSource:'local',localBooks:[{id:'a'.repeat(24),title:'合成本地图书',path:'synthetic.epub',bookmarks:[]}]};p.localEntry=p.settings.localBooks[0];p.localBook=book;p.localReader=reader;p.ready=true;p.persisted=0;p.persist=()=>p.persisted++;p.show=()=>{};p.localClosedBooks=new WeakSet();p.localToolsModal=null;
  reader.applyAppearance({localTypography:'publisher',readingFlow:'scroll',continuousChapters:false,literature:{enabled:false}});
  let report;
  try {
    await reader.setBook(book,{chapter:0,paragraph:1,offset:0});await pause();
    const bookmark=p.addLocalBookmark();assert('bookmark captures current rendered paragraph and normalized excerpt',bookmark.chapter===0&&bookmark.paragraph===1&&bookmark.excerpt==='before needle after。',{chapter:bookmark.chapter,paragraph:bookmark.paragraph,excerpt:bookmark.excerpt});
    assert('bookmark modal opens from local controls',p.showLocalBookmarks()&&!!p.localToolsModal);const bookmarksModal=p.localToolsModal;
    assert('bookmark list renders plain text in compact row',bookmarksModal.contentEl.querySelectorAll('.wrp-local-tool-row').length===1&&bookmarksModal.contentEl.querySelector('.wrp-local-tool-excerpt').textContent==='before needle after。');
    const bounds=bookmarksModal.contentEl.getBoundingClientRect();assert('narrow bookmark list and buttons stay within modal', [...bookmarksModal.contentEl.querySelectorAll('button')].every(node=>{const r=node.getBoundingClientRect();return !r.width||(r.left>=bounds.left-1&&r.right<=bounds.right+1);}));
    p.closeLocalTools();assert('search modal opens with bounded result controls',p.showLocalSearch());const modal=p.localToolsModal;modal.input.value='needle';await modal.runSearch();await pause();
    assert('whole-book search finds text across inline markup and all chapters',modal.results.length===3&&modal.results[0].chapter===0&&modal.results[0].paragraph===1&&modal.results[1].chapter===1&&modal.results[1].paragraph===0&&modal.results[2].paragraph===1,modal.results.map(r=>({chapter:r.chapter,paragraph:r.paragraph,matchStart:r.matchStart})));
    assert('search results render safe highlighted literal text',modal.list.querySelectorAll('mark').length===3&&modal.list.querySelectorAll('script').length===0);
    const modalBounds=modal.contentEl.getBoundingClientRect();assert('narrow search controls stay within modal', [...modal.contentEl.querySelectorAll('input,button')].every(node=>{const r=node.getBoundingClientRect();return !r.width||(r.left>=modalBounds.left-1&&r.right<=modalBounds.right+1);}));
    const paragraphs=reader.getSearchParagraphs(await book.readChapter(0),0);
    assert('image paragraphs retain anchor indexes without placeholder text',paragraphs[2]===''&&paragraphs[3]==='CaptionOnlyText：真实图注。',{imageParagraph:paragraphs[2],captionParagraph:paragraphs[3]});
    modal.input.value='ONLY_IMAGE_METADATA_TOKEN';await modal.runSearch();
    assert('image alt metadata and generated placeholder text are not searchable',modal.results.length===0);
    modal.input.value='CaptionOnlyText';await modal.runSearch();
    assert('visible captions remain searchable at unchanged paragraph index',modal.results.length===1&&modal.results[0].chapter===0&&modal.results[0].paragraph===3,{results:modal.results.map(result=>({chapter:result.chapter,paragraph:result.paragraph}))});
    modal.input.value='needle';await modal.runSearch();
    const last=modal.results[2];assert('exact long paragraph search jump succeeds',await p.jumpToLocalPosition({chapter:last.chapter,paragraph:last.paragraph,offset:0},{highlight:'needle',matchStart:last.matchStart,matchLength:last.matchLength}));await pause();
    assert('search jump retains matching paragraph and scrolls into long paragraph',reader.captureProgress().chapter===1&&reader.captureProgress().paragraph===1&&host.querySelector('.wrp-local-scroll').scrollTop>400,{progress:reader.captureProgress(),scrollTop:host.querySelector('.wrp-local-scroll').scrollTop});
    p.closeLocalTools();assert('bookmark restores earlier chapter and paragraph after search',await p.jumpToLocalPosition(bookmark));await pause();assert('restored bookmark uses its saved paragraph',reader.captureProgress().chapter===0&&reader.captureProgress().paragraph===1);
    let release;book.readChapter=()=>new Promise(resolve=>{release=resolve;});p.showLocalSearch();const pendingModal=p.localToolsModal;pendingModal.input.value='needle';const pending=pendingModal.runSearch();await pause();p.closeLocalTools();release({html:'<p>needle stale text</p>'});await pending;assert('closing search cancels pending reads and releases modal result DOM',!pendingModal.modalEl.isConnected&&pendingModal.results.length===0&&p.localToolsModal===null);
    assert('removing bookmark keeps book and reader intact',p.removeLocalBookmark(p.localEntry.id,bookmark.id)&&p.localEntry.bookmarks.length===0&&p.localReader===reader&&reader.book===book);
    report={passed:true,checks};
  } catch(error){report={passed:false,error:error.message,checks};}
  finally{p.closeLocalTools();reader.destroy();for(const modal of modals)modal.close();host.remove();style.remove();}
  report.cleanup={hostRemoved:!host.isConnected,styleRemoved:!style.isConnected,surfaceRemoved:!reader.root.isConnected,modalsRemoved:modals.every(modal=>!modal.modalEl.isConnected)};return report;
})
