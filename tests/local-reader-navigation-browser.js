(async function validateLocalReaderNavigation(options) {
  const {document,factory,css}=options,view=document.defaultView;
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:380px;height:320px;display:flex;visibility:hidden;';document.body.append(host);
  const input=document.createElement('input');input.style.cssText='position:fixed;left:-20000px;top:0;';document.body.append(input);
  const previousFocus=document.activeElement,checks=[],errors=[],saved=[],reads=[];
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms||70));
  const assert=(name,pass,details)=>{checks.push({name,pass:!!pass,...details?{details}:{}});if(!pass)throw new Error(name);};
  const until=async test=>{for(let i=0;i<45;i++){if(test()){await pause();return;}await pause();}throw new Error('navigation fixture did not settle');};
  const api=factory({host,document,onProgress:value=>saved.push({...value}),onError:error=>errors.push(error)}),scroll=api.root.querySelector('.wrp-local-scroll');
  const config={fontSize:18,lineHeight:1.4,paragraphSpacing:0,contentPadding:12,continuousChapters:false,readingFlow:'scroll',localTypography:'custom',literature:{enabled:false}};
  const fixture={id:'synthetic-navigation-book',title:'Synthetic navigation fixture',chapters:Array.from({length:7},(_,index)=>({title:'Chapter '+index,href:'Text/'+index+'.xhtml'})),
    async readChapter(index){reads.push(index);return {href:'Text/'+index+'.xhtml',html:Array.from({length:55},(_,number)=>'<p>Paragraph '+number+' supplies enough synthetic words to occupy several text lines within this reading surface.</p>').join(''),publisherStyles:['p { font-size:20px; line-height:1.75; margin:0; text-indent:2em; }']};}};
  let report;
  try{
    api.applyAppearance(config);await api.setBook(fixture,{chapter:1,paragraph:4,offset:0});await pause(180);input.focus();
    const customTop=scroll.scrollTop;await api.scrollByDirection(1);const customDelta=scroll.scrollTop-customTop;
    assert('custom shortcut scrolls by three configured lines',Math.abs(customDelta-18*1.4*3)<1.2,{delta:customDelta});
    await api.scrollByDirection(-1);assert('reverse shortcut restores same scroll position',Math.abs(scroll.scrollTop-customTop)<1.2);
    assert('scroll shortcuts preserve main-interface focus',document.activeElement===input);
    api.applyAppearance({...config,localTypography:'publisher'});await pause(180);
    const publisherTop=scroll.scrollTop;await api.scrollByDirection(1);const publisherDelta=scroll.scrollTop-publisherTop;
    assert('publisher shortcut uses actual book line height',Math.abs(publisherDelta-20*1.75*3)<1.2,{delta:publisherDelta});
    await api.navigateChapter(1);await pause(180);
    assert('chapter shortcut opens next chapter at its start',api.captureProgress().chapter===2&&api.captureProgress().paragraph===0&&api.captureProgress().offset===0,{progress:api.captureProgress()});
    assert('chapter shortcut preserves main-interface focus',document.activeElement===input);
    await api.navigateChapter(-1);await pause(180);assert('previous chapter shortcut opens preceding chapter',api.chapter===1&&api.captureProgress().paragraph===0);
    await api.navigate(0);await pause(180);assert('previous chapter boundary returns false',await api.navigateChapter(-1)===false&&api.chapter===0);
    await api.navigate(6);await pause(180);assert('next chapter boundary returns false',await api.navigateChapter(1)===false&&api.chapter===6);
    api.applyAppearance({...config,continuousChapters:true});await api.navigate(1);await until(()=>api.stats.pendingChapterReads===0&&api.stats.chapterIndexes.includes(2));
    const cachedReads=reads.filter(index=>index===2).length;
    await api.navigateChapter(1);await until(()=>api.stats.pendingChapterReads===0);
    assert('continuous chapter shortcut reuses cached chapter and jumps to start',api.captureProgress().chapter===2&&api.captureProgress().paragraph===0&&api.captureProgress().offset===0&&reads.filter(index=>index===2).length===cachedReads,{progress:api.captureProgress(),stats:api.stats});
    const visible=api.root.querySelector('[data-wrp-chapter="3"] [data-wrp-paragraph="10"]');
    assert('next continuous chapter is preloaded for visible-anchor check',!!visible);
    scroll.scrollTop=visible.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop;
    await api.navigateChapter(1);await until(()=>api.stats.pendingChapterReads===0);
    assert('chapter target follows actual visible chapter',api.captureProgress().chapter===4&&api.captureProgress().paragraph===0,{progress:api.captureProgress()});
    assert('chapter commands keep continuous window bounded',api.stats.renderedChapters<=3&&api.stats.maxRenderedChapters<=3,api.stats);
    api.applyAppearance({...config,readingFlow:'paged'});await api.navigate(2);await pause(180);
    const pagedTop=scroll.scrollTop;await api.scrollByDirection(1);
    assert('paged shortcut uses the existing page turn',Math.abs((scroll.scrollTop-pagedTop)-scroll.clientHeight*.88)<1.2,{delta:scroll.scrollTop-pagedTop,height:scroll.clientHeight});
    let releaseRead;const delayed={...fixture,id:'synthetic-delayed-navigation',async readChapter(index){if(index===1)return new Promise(resolve=>{releaseRead=()=>resolve({paragraphs:Array.from({length:55},(_,number)=>'Delayed paragraph '+number+'.')});});return fixture.readChapter(index);}};
    api.applyAppearance(config);await api.setBook(delayed);
    const first=api.navigateChapter(1);await until(()=>!!releaseRead);const second=api.navigateChapter(1);releaseRead();
    assert('rapid chapter commands complete in order',await first===true&&await second===true&&api.chapter===2,{progress:api.captureProgress()});
    const old=api.navigateChapter(-1);await until(()=>!!releaseRead);const cancelled=api.navigateChapter(1);
    await api.setBook(fixture,{chapter:4,paragraph:0,offset:0});
    const current=api.navigateChapter(1);assert('new book navigation does not wait for old pending read',await current===true&&api.chapter===5);
    releaseRead();assert('old queued chapter commands cannot overwrite replacement book',await old===false&&await cancelled===false&&api.book===fixture&&api.chapter===5);
    assert('invalid navigation directions are ignored',await api.navigateChapter(0)===false&&await api.scrollByDirection(NaN)===false);
    assert('all background shortcuts preserve focused editor control',document.activeElement===input);
    api.destroy();assert('destroyed reader ignores shortcut commands',await api.navigateChapter(1)===false&&await api.scrollByDirection(1)===false);
    report={version:'0.4.2',runtime:'Obsidian desktop',passed:true,checks,errors};
  }catch(error){report={version:'0.4.2',runtime:'Obsidian desktop',passed:false,error:error.message,checks,stats:api.stats};}
  finally{api.destroy();host.remove();input.remove();style.remove();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
  report.cleanup={hostRemoved:!host.isConnected,surfaceRemoved:!api.root.isConnected,inputRemoved:!input.isConnected,styleRemoved:!style.isConnected};
  return report;
})
