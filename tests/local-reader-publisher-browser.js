(async function validatePublisherTypography(options) {
  const {document,factory,css}=options,view=document.defaultView,checks=[];
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:420px;height:320px;display:flex;visibility:hidden;';document.body.append(host);
  const outside=document.createElement('p');outside.textContent='Outside reader fixture';outside.style.cssText='font-size:17px;color:rgb(1,2,3)';host.before(outside);
  const reader=factory({document,host}),pause=()=>new Promise(r=>setTimeout(r,100));
  const assert=(name,pass,details)=>{checks.push({name,pass:!!pass,...details?{details}:{}});if(!pass)throw Error(name);};
  const appearance={localTypography:'publisher',fontSize:14,lineHeight:1.1,paragraphSpacing:0,contentPadding:4,readingFlow:'scroll',continuousChapters:false,literature:{enabled:false}};
  const fixture={id:'publisher-style-fixture',title:'Publisher fixture',format:'EPUB',chapters:[{title:'Original heading',href:'Text/1.xhtml'}],async readChapter(){return {href:'Text/1.xhtml',html:'<div class="wrap"><h2>Original heading</h2><p class="story" id="first">原书缩进正文，<span style="font-weight:700">行内强调</span>保留。</p><p class="story" id="spaces">　　原文已有空格。</p><p class="story" id="inline" style="font-size:23px;text-indent:1em">行内正文样式。</p><p class="story" id="flow">正文保留原书的段落间距。</p></div>',publisherHtml:{style:'font-size:18px'},publisherBody:{className:'book',id:'chapter',style:'margin:0'},publisherStyles:['html {font-size:18px} body.book {line-height:1.4;margin:0} .wrap > p.story {font-size:20px;line-height:1.8;text-indent:2em;margin:0 0 6px;text-align:justify;letter-spacing:0} #first {font-weight:600} h2{font-size:24px;margin:0 0 12px} @media (min-width:1px) {p.story{word-spacing:0}}','@import url(https://wrp-invalid.example/style.css); @font-face {font-family:unsafe;src:url(https://wrp-invalid.example/font.woff)} body,p {background-image:url(https://wrp-invalid.example/image);color:red;position:fixed;z-index:99999}']};}};
  const byId=id=>reader.root.querySelector('[data-wrp-anchor="'+id+'"]');
  let report;
  try{
    reader.applyAppearance(appearance);await reader.setBook(fixture,{chapter:0,paragraph:0,offset:0});await pause();
    let first=view.getComputedStyle(byId('first'));
    assert('publisher CSS restores original paragraph font and indent',parseFloat(first.fontSize)===20&&parseFloat(first.textIndent)===40,{font:first.fontSize,indent:first.textIndent});
    assert('publisher line and paragraph spacing override custom preferences',parseFloat(first.lineHeight)===36&&parseFloat(first.marginBottom)===6,{line:first.lineHeight,paragraph:first.marginBottom});
    assert('original text alignment and ID selectors are retained',first.textAlign==='justify'&&Number(first.fontWeight)===600);
    assert('original wrappers and parent selectors are retained',!!reader.root.querySelector('[data-wrp-publisher-class="wrap"] > p'));
    assert('original inline typography is retained',parseFloat(view.getComputedStyle(byId('inline')).fontSize)===23&&parseFloat(view.getComputedStyle(byId('inline')).textIndent)===23);
    assert('original heading keeps source font without duplicate generated title',reader.root.querySelectorAll('h2').length===1&&parseFloat(view.getComputedStyle(reader.root.querySelector('h2')).fontSize)===24);
    assert('publisher mode preserves leading whitespace verbatim',byId('spaces').textContent.startsWith('　　'));
    assert('publisher CSS cannot style outside reader',parseFloat(view.getComputedStyle(outside).fontSize)===17&&view.getComputedStyle(outside).color==='rgb(1, 2, 3)');
    const stylesheet=reader.root.querySelector('.wrp-local-publisher style').textContent;
    assert('URLs imports fonts colors and positioning are absent from live stylesheet',!/url\s*\(|@import|@font-face|background|position|z-index|color:/i.test(stylesheet));
    const publisherFont=first.fontSize;reader.applyAppearance({...appearance,fontSize:30,lineHeight:3,paragraphSpacing:60,contentPadding:120});await pause();
    assert('custom preferences do not alter publisher typography',view.getComputedStyle(byId('first')).fontSize===publisherFont&&parseFloat(view.getComputedStyle(byId('first')).marginBottom)===6);
    const originalNode=byId('first');reader.applyAppearance({...appearance,localTypography:'custom'});await pause();first=view.getComputedStyle(byId('first'));
    assert('custom mode uses its saved size spacing and two-em indent',parseFloat(first.fontSize)===14&&parseFloat(first.textIndent)===28&&parseFloat(first.marginBottom)===0&&first.textAlign==='start');
    assert('custom mode removes publisher inline styles',parseFloat(view.getComputedStyle(byId('inline')).fontSize)===14);
    assert('custom mode normalizes old prefix once',byId('spaces').textContent==='原文已有空格。');
    assert('switching reuses paragraph DOM and removes publisher stylesheet',byId('first')===originalNode&&!reader.root.querySelector('.wrp-local-publisher'));
    reader.applyAppearance(appearance);await pause();
    assert('returning to publisher restores hierarchy and whitespace',byId('first')===originalNode&&byId('spaces').textContent.startsWith('　　')&&parseFloat(view.getComputedStyle(byId('first')).textIndent)===40);
    reader.applyAppearance({...appearance,literature:{enabled:true,paragraphs:2,english:'A neutral scholarly-style excerpt.'}});await pause();
    assert('literature cards always use own typography and alignment',!!reader.root.querySelector('.wrp-local-card')&&!reader.root.querySelector('.wrp-local-publisher')&&parseFloat(view.getComputedStyle(byId('first')).fontSize)===14&&parseFloat(view.getComputedStyle(byId('first')).textIndent)===0);
    const txt={id:'original-txt',format:'TXT',chapters:[{title:'TXT heading'}],async readChapter(){return {paragraphs:['TXT original line.','Next line.'],originalParagraphs:['　　TXT original line.','  Next line.']};}};
    reader.applyAppearance(appearance);await reader.setBook(txt,{chapter:0,paragraph:0,offset:0});await pause();
    const textParagraphs=()=>[...reader.root.querySelectorAll('.wrp-local-prose')];
    assert('TXT original mode retains its literal first-line spaces',textParagraphs()[0].textContent.startsWith('　　')&&textParagraphs()[1].textContent.startsWith('  ')&&view.getComputedStyle(textParagraphs()[0]).whiteSpace==='pre-wrap');
    reader.applyAppearance({...appearance,localTypography:'custom'});await pause();
    assert('TXT custom mode replaces raw prefixes with single two-em indent',textParagraphs()[0].textContent==='TXT original line.'&&parseFloat(view.getComputedStyle(textParagraphs()[0]).textIndent)===28);
    assert('typography switches preserve chapter paragraph anchors',reader.captureProgress().chapter===0&&textParagraphs().every(node=>node.hasAttribute('data-wrp-paragraph')));
    report={version:'0.4.1',runtime:'Obsidian desktop',passed:true,checks};
  }catch(error){report={version:'0.4.1',runtime:'Obsidian desktop',passed:false,error:error.message,checks};}
  finally{reader.destroy();host.remove();outside.remove();style.remove();}
  report.cleanup={surfaceRemoved:!reader.root.isConnected,hostRemoved:!host.isConnected,styleRemoved:!style.isConnected};return report;
})
