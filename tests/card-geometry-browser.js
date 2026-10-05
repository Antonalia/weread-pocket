// Evaluated by the Obsidian CLI wrapper with a caller-supplied project root.
(async(projectRoot)=>{
 const fs=require('fs'),path=require('path');
 if(!projectRoot)throw new Error('Pass the project root to this audit, or use run-obsidian-card-geometry.ps1');
 const helper=fs.readFileSync(path.join(projectRoot,'src','create-literature-cards.js'),'utf8'),plugin=app.plugins.plugins['weread-pocket'];
 if(!plugin?.webview)return JSON.stringify({pass:false,error:'Reader guest is not available'});
 const run=async function(){
  const iframe=document.createElement('iframe');
  iframe.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;height:1800px;border:0;pointer-events:none;';
  document.body.appendChild(iframe);
  const cases=[],results=[];
  for(const width of [280,420,900])for(const [size,line] of [[12,1.3],[24,1.7]])for(const paragraphs of [1,3])for(const paragraphSpacing of [0,6])cases.push({width,size,line,paragraphs,paragraphSpacing});
  const almost=(a,b)=>Math.abs(a-b)<=0.1;
  try{
   for(const test of cases){
    iframe.width=String(test.width);iframe.style.width=test.width+'px';
    const loaded=new Promise(resolve=>iframe.onload=resolve);
    iframe.srcdoc=`<!doctype html><html><head><style>:root{--wrp-border:#65728c;--wrp-text-normal:#ccd3df;--wrp-text-muted:#aab2c1}body{margin:0;background:#27282e}.pre{position:absolute;top:0;left:0;visibility:hidden;width:${test.width}px}.pre p{margin:0;padding-top:0;padding-bottom:${test.paragraphSpacing}px;font:${test.size}px/${test.size*test.line}px Arial,sans-serif;overflow-wrap:anywhere}.target{position:relative;width:${test.width}px}.canvas{position:absolute;inset:0;z-index:2;background:#27282e}</style></head><body><div class="pre"><div class="content"><p>这是用于排版验证的示例段落。主题中的字号与间距应该一致。</p><p>文字应当保留左右留白，外边框与内部横线需要完整相接。</p><p>Readability improves when related blocks use a consistent baseline and spacing.</p><p>更改字体或窗口宽度后，卡片仍然应该保留正常的内缩。</p><p>这是一段较短的排版测试文字。</p><p>布局检查只使用虚构示例，不读取书籍或账户内容。</p></div></div><div class="target"><div class="canvas"></div></div></body></html>`;
    await loaded;
    const d=iframe.contentDocument,w=iframe.contentWindow,root=d.querySelector('.pre'),content=d.querySelector('.content'),target=d.querySelector('.target');
    const reader={$refs:{preRenderContainer:root,preRenderContent:content,renderTargetContainer:target},chapterContentState:'DONE',renderContentsVersion:1};
    const config={enabled:true,english:'A consistent interpretation requires comparing events with the surrounding conditions. The following notes record the relevant details.',paragraphs:test.paragraphs};
    const cards=createLiteratureCards({reader,chapterKey:()=>1,getParagraphSpacing:()=>test.paragraphSpacing,getConfig:()=>config,eventDocument:d});
    const before=[...content.querySelectorAll('p')].map(p=>p.getAttribute('style'));
    cards.prepare();target.style.height=root.getBoundingClientRect().height+'px';cards.collected(1,1);
    const layer=target.querySelector('.wrp-literature-cards'),boxes=[...layer.querySelectorAll('.wrp-literature-card')],paragraphNodes=[...content.querySelectorAll('p')];
    const cr=target.getBoundingClientRect(),origin=root.getBoundingClientRect();
    const details=boxes.map((box,index)=>{
     const r=box.getBoundingClientRect(),quote=box.querySelector('.wrp-literature-english'),q=quote.getBoundingClientRect(),header=box.querySelector('.wrp-literature-card-header').getBoundingClientRect(),divider=box.querySelector('.wrp-literature-body-divider').getBoundingClientRect(),style=w.getComputedStyle(box),qs=w.getComputedStyle(quote);
     const group=paragraphNodes.slice(index*test.paragraphs,(index+1)*test.paragraphs),first=group[0],last=group.at(-1),ps=w.getComputedStyle(first),firstR=first.getBoundingClientRect(),lastR=last.getBoundingClientRect();
     const textLeft=firstR.left-origin.left+parseFloat(ps.paddingLeft),textRight=firstR.right-origin.left-parseFloat(ps.paddingRight),bodyTop=firstR.top-origin.top+parseFloat(ps.paddingTop),bodyBottom=lastR.bottom-origin.top-parseFloat(w.getComputedStyle(last).paddingBottom);
     return {index,left:r.left-cr.left,right:r.right-cr.left,top:r.top-cr.top,bottom:r.bottom-cr.top,quoteLeft:q.left-r.left,quoteRight:r.right-q.right,dividerLeft:divider.left-r.left,dividerRight:r.right-divider.right,headerLeft:header.left-r.left,headerRight:r.right-header.right,textLeft,textRight,bodyTop,bodyBottom,quoteBottom:q.bottom-cr.top,dividerBottom:divider.bottom-cr.top,borderLeft:parseFloat(style.borderLeftWidth),borderRight:parseFloat(style.borderRightWidth),borderBottom:parseFloat(style.borderBottomWidth),fontSize:qs.fontSize,lineHeight:qs.lineHeight,bodyFont:ps.fontSize,bodyLine:ps.lineHeight,paddingLeft:ps.paddingLeft,paddingRight:ps.paddingRight};
    });
    const checks={
     aboveCanvas:parseInt(w.getComputedStyle(layer).zIndex)>parseInt(w.getComputedStyle(target.querySelector('.canvas')).zIndex),
     preservesSelection:w.getComputedStyle(layer).pointerEvents==='none',
     continuousEdges:details.every(x=>almost(x.left,0)&&almost(x.right,test.width)&&almost(x.dividerLeft,x.borderLeft)&&almost(x.dividerRight,x.borderRight)&&almost(x.headerLeft,x.borderLeft)&&almost(x.headerRight,x.borderRight)),
     matchingInset:details.every(x=>almost(x.quoteLeft,9)&&almost(x.quoteRight,9)&&almost(x.textLeft,9)&&almost(x.textRight,test.width-9)),
     matchingTypography:details.every(x=>x.fontSize===test.size+'px'&&x.bodyFont===test.size+'px'&&almost(parseFloat(x.lineHeight),test.size*test.line)&&almost(parseFloat(x.bodyLine),test.size*test.line)),
     noBodyOverlap:details.every(x=>x.bodyTop>=x.dividerBottom+3&&x.bodyBottom<=x.bottom-x.borderBottom-3),
     noCardTags:target.querySelectorAll('.wrp-literature-tags,.wrp-literature-tag').length===0,
     compactBottomSpace:details.every(x=>almost(x.bottom-x.borderBottom-x.bodyBottom,test.paragraphSpacing+4)),
     orderedCards:details.every((x,i)=>i===0||x.top>=details[i-1].bottom+10)
    };
    cards.dispose();
    checks.restoredParagraphStyles=paragraphNodes.every((p,i)=>(p.getAttribute('style')||'')===(before[i]||''));
    results.push({...test,pass:Object.values(checks).every(Boolean),checks,first:details[0],last:details.at(-1)});
   }
   return {pass:results.every(r=>r.pass),cases:results.length,environment:{engine:'Chromium / Blink',userAgent:navigator.userAgent,devicePixelRatio},results};
  }finally{iframe.remove();}
 };
 const response=await plugin.webview.executeJavaScript('('+async function(helperText,runText){const createLiteratureCards=eval('('+helperText+')');return await eval('('+runText+')')();}.toString()+')('+JSON.stringify(helper)+','+JSON.stringify(run.toString())+')');
 const reference=document.querySelector('.zt-annot-card'),list=document.querySelector('.annots-container');
 const style=e=>{if(!e)return null;const c=getComputedStyle(e);return {fontSize:c.fontSize,lineHeight:c.lineHeight,fontFamily:c.fontFamily,padding:c.padding,border:c.borderWidth,borderRadius:c.borderRadius};};
 const body=getComputedStyle(document.body);
 const report={validatedAt:new Date().toISOString(),fixture:'Synthetic Chinese and English paragraphs; no account or book content is included.',scope:'Ephemeral isolated iframe only; no installed plugin, persistent preferences or book state are changed.',...response,environment:{...response.environment,coordinateSpace:'Guest CSS pixels',hostDevicePixelRatio:devicePixelRatio,guestZoomFactor:typeof plugin.webview.getZoomFactor==='function'?plugin.webview.getZoomFactor():null},reference:{body:style(document.body),themeUiSmall:body.getPropertyValue('--font-ui-small').trim(),themeUiSmaller:body.getPropertyValue('--font-ui-smaller').trim(),list:style(list),card:style(reference),english:style(reference?.querySelector('blockquote')),chinese:style(reference?.querySelector('.zt-annot-comment'))}};
 fs.mkdirSync(path.join(projectRoot,'docs'),{recursive:true});
 fs.writeFileSync(path.join(projectRoot,'docs','validation-card-geometry.json'),JSON.stringify(report,null,2)+'\n','utf8');
 return JSON.stringify({pass:response.pass,cases:response.cases,environment:report.environment,reference:report.reference,failed:response.results.filter(result=>!result.pass),report:'docs/validation-card-geometry.json'});
})
