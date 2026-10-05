(async function validateLocalProseIndent(options) {
  const {document,factory,css}=options,view=document.defaultView;
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:440px;height:340px;display:flex;visibility:hidden;';document.body.append(host);
  const reader=factory({document,host}),checks=[];
  const assert=(name,pass,details)=>{checks.push({name,pass:!!pass,...details?{details}:{}});if(!pass)throw new Error(name);};
  const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
  const px=node=>parseFloat(view.getComputedStyle(node).textIndent);
  const appearance={fontSize:20,lineHeight:1.6,paragraphSpacing:0,contentPadding:4,readingFlow:'scroll',continuousChapters:false,literature:{enabled:false}};
  const book={id:'synthetic-indent',title:'Synthetic indent fixture',chapters:[{title:'Chapter fixture',href:'Text/1.xhtml'}],async readChapter(){return {href:'Text/1.xhtml',html:'<h2>Chapter fixture</h2><p id="plain">正文首行缩进，换行后的正文仍从边缘开始。</p><p id="spaced"><span>　 </span><strong>　正文已有空格缩进。</strong></p><p id="publisher" style="font-size:99px;text-indent:8em" onclick="window.__WRP_INDENT_UNSAFE=1">正文沿用阅读器自己的排版。</p><h3 id="heading">小标题</h3><blockquote><p id="quotation">块引用保留结构。</p></blockquote><ul><li><p id="listed">列表内容不额外缩进。</p></li></ul><table><tr><td><p id="cell">表格内容。</p></td></tr></table><pre id="code">  preserved code</pre><p id="inline-code"><code>  preserved inline code</code></p><p id="footnote"><a href="#plain">正文注释链接</a></p>'};}};
  let report;
  try {
    reader.applyAppearance(appearance);await reader.setBook(book,{chapter:0,paragraph:0,offset:0});await pause();
    const byId=id=>reader.root.querySelector('[data-wrp-anchor="'+id+'"]');
    assert('normal EPUB prose has exactly two em first-line indent',px(byId('plain'))===40,{indent:px(byId('plain'))});
    assert('nested inline leading full-width spaces are removed once',byId('spaced').textContent==='正文已有空格缩进。'&&px(byId('spaced'))===40);
    assert('publisher typography and handlers cannot override own style',!byId('publisher').hasAttribute('style')&&!byId('publisher').hasAttribute('onclick')&&px(byId('publisher'))===40&&parseFloat(view.getComputedStyle(byId('publisher')).fontSize)===20);
    assert('chapter and section headings are unindented',px(reader.root.querySelector('.wrp-local-chapter-title'))===0&&px(byId('heading'))===0);
    assert('blockquote paragraphs do not receive prose indent',px(byId('quotation'))===0);
    assert('list paragraphs do not receive prose indent',px(byId('listed'))===0);
    assert('table paragraphs do not receive prose indent',px(byId('cell'))===0);
    assert('pre and inline code whitespace are preserved',byId('code').textContent==='  preserved code'&&byId('inline-code').textContent==='  preserved inline code'&&px(byId('inline-code'))===0);
    assert('paragraph anchors and book links remain intact',byId('footnote').querySelector('a').dataset.wrpLocalHref==='#plain');
    reader.applyAppearance({...appearance,fontSize:14});await pause();
    assert('first-line indent scales with current window font size',px(byId('plain'))===28);
    reader.applyAppearance({...appearance,literature:{enabled:true,paragraphs:3,english:'Synthetic English excerpt with natural spaces.'}});await pause();
    assert('literature Chinese card body stays aligned without prose indent',px(byId('plain'))===0&&px(byId('spaced'))===0);
    assert('literature English card quote stays unindented',px(reader.root.querySelector('.wrp-local-card-quote p'))===0);
    assert('card headers keep their established alignment',parseFloat(view.getComputedStyle(reader.root.querySelector('.wrp-local-card-header')).textIndent)===0);
    const txt={id:'synthetic-txt-indent',title:'Synthetic TXT fixture',chapters:[{title:'TXT chapter'}],async readChapter(){return {paragraphs:['　　TXT 正文的原有缩进。','  ASCII-leading indent paragraph.','首行文字\n  原文的后续行空格保留。']};}};
    reader.applyAppearance(appearance);await reader.setBook(txt,{chapter:0,paragraph:0,offset:0});await pause();
    const paragraphs=[...reader.root.querySelectorAll('.wrp-local-prose')];
    assert('TXT full-width prefix becomes one two-em indent',paragraphs[0].textContent==='TXT 正文的原有缩进。'&&px(paragraphs[0])===40);
    assert('TXT ASCII prefix avoids double indent',paragraphs[1].textContent==='ASCII-leading indent paragraph.'&&px(paragraphs[1])===40);
    assert('manual linebreak and following whitespace remain unchanged',paragraphs[2].textContent==='首行文字\n  原文的后续行空格保留。');
    report={version:'0.4.1',runtime:'Obsidian desktop',passed:true,checks};
  } catch(error) {report={version:'0.4.1',runtime:'Obsidian desktop',passed:false,error:error.message,checks};}
  finally {reader.destroy();host.remove();style.remove();}
  report.cleanup={surfaceRemoved:!reader.root.isConnected,hostRemoved:!host.isConnected,styleRemoved:!style.isConnected};return report;
})
