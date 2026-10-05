(async function validateLocalReaderFormats({document,factory,css,includeLarge=true}) {
  const view=document.defaultView,checks=[],errors=[];
  const assert=(name,passed,detail)=>{checks.push({name,pass:!!passed,detail});if(!passed)throw new Error(name);};
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:420px;height:320px;display:flex;visibility:hidden';document.body.append(host);
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  const reader=factory({document,host,onError:error=>errors.push(error)}),pause=()=>new Promise(resolve=>setTimeout(resolve,60));
  const appearance={localTypography:'publisher',fontSize:14,lineHeight:1.3,paragraphSpacing:2,contentPadding:8,readingFlow:'scroll',continuousChapters:false,literature:{enabled:false}};
  const book=(id,payload)=>({id,title:id,chapters:[{title:id,href:'one.xhtml'}],async readChapter(){return payload;}});
  const paragraphIndexes=()=>[...reader.root.querySelectorAll('[data-wrp-paragraph]')].map(node=>Number(node.dataset.wrpParagraph));
  let report;
  try {
    reader.applyAppearance(appearance);
    await reader.setBook(book('Original TXT blanks',{paragraphs:['甲。','乙。'],originalParagraphs:['','　　甲。','','  ','乙。'],originalParagraphIndexes:[null,0,null,null,1]}));await pause();
    let blanks=[...reader.root.querySelectorAll('.wrp-local-txt-blank')];
    assert('original TXT keeps every real blank row',blanks.length===3&&blanks.every(node=>node.getBoundingClientRect().height>0),{rows:blanks.length});
    assert('TXT blank rows never consume reading or search paragraph indexes',JSON.stringify(paragraphIndexes())==='[0,1]',{indexes:paragraphIndexes()});
    const originalFirst=reader.root.querySelector('[data-wrp-paragraph="0"]');assert('TXT original whitespace remains verbatim',originalFirst.textContent==='　　甲。');
    reader.applyAppearance({...appearance,localTypography:'custom'});await pause();
    assert('custom typography hides original blank rows',blanks.every(node=>view.getComputedStyle(node).display==='none'));
    assert('custom typography normalizes prefix without moving indexes',originalFirst.textContent==='甲。'&&JSON.stringify(paragraphIndexes())==='[0,1]');
    reader.applyAppearance(appearance);await pause();assert('restoring publisher returns same blank row DOM and whitespace',blanks.every(node=>node.isConnected&&node.getBoundingClientRect().height>0)&&originalFirst.textContent==='　　甲。');
    await reader.setBook(book('Original EPUB blanks',{html:'<p id="a">甲。</p><p class="empty" id="blank"></p><p id="br"><br/></p><p id="b">乙。</p>',publisherStyles:['p.empty {min-height:20px;margin:0}']}));await pause();
    const empty=reader.root.querySelector('[data-wrp-anchor="blank"]'),br=reader.root.querySelector('[data-wrp-anchor="br"]');
    assert('original EPUB keeps styled empty paragraphs and explicit line breaks',empty?.getBoundingClientRect().height>=20&&br?.getBoundingClientRect().height>0,{empty:empty?.getBoundingClientRect().height,br:br?.getBoundingClientRect().height});
    assert('EPUB blank rows do not consume content paragraph indexes',JSON.stringify(paragraphIndexes())==='[0,1]',{indexes:paragraphIndexes()});
    reader.applyAppearance({...appearance,localTypography:'custom'});await pause();assert('custom EPUB hides blank rows',view.getComputedStyle(empty).display==='none'&&view.getComputedStyle(br).display==='none');
    reader.applyAppearance(appearance);
    const imageBook=book('Publisher image dimensions',{html:'<p>图像尺寸。</p><img id="image" src="pixel.png" width="120" height="60" alt="Pixel"/>'});
    imageBook.readResource=async()=>({mime:'image/png',data:Uint8Array.from(view.atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='),char=>char.charCodeAt(0))});
    await reader.setBook(imageBook);
    let image;for(let retry=0;retry<30&&!image;retry++){await pause();image=reader.root.querySelector('.wrp-local-image');}
    assert('EPUB width and height attributes survive image loading',image?.getAttribute('width')==='120'&&image?.getAttribute('height')==='60');
    assert('publisher displays both original dimensions',parseFloat(view.getComputedStyle(image).width)===120&&parseFloat(view.getComputedStyle(image).height)===60,{width:view.getComputedStyle(image).width,height:view.getComputedStyle(image).height});
    reader.applyAppearance({...appearance,localTypography:'custom'});await pause();reader.applyAppearance(appearance);await pause();
    assert('image dimensions survive typography round trip',parseFloat(view.getComputedStyle(image).width)===120&&parseFloat(view.getComputedStyle(image).height)===60);
    // Pixel budgets are checked before allocating object URLs or asking the
    // browser to decode a deceptively small, enormous-dimension image.
    const pixel=Uint8Array.from(view.atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='),char=>char.charCodeAt(0));
    const giant=Uint8Array.from(pixel),header=new DataView(giant.buffer);header.setUint32(16,100000);header.setUint32(20,100000);
    const giantBook=book('Oversized image header',{html:'<img src="giant.png" alt="Too large"/>'});let giantReads=0,createdURLs=0;
    giantBook.readResource=async()=>{giantReads++;return {mime:'image/png',data:giant};};
    const createURL=view.URL.createObjectURL;
    try {
      view.URL.createObjectURL=function(...args){createdURLs++;return createURL.apply(this,args);};
      await reader.setBook(giantBook);for(let retry=0;retry<30&&!giantReads;retry++)await pause();await pause();
      assert('small image bytes with enormous dimensions are rejected before blob creation',giantReads===1&&createdURLs===0&&!reader.root.querySelector('img'),{headerPixels:100000*100000,compressedBytes:giant.byteLength,resourceReads:giantReads,createdURLs});
      assert('rejected image consumes no tracked bytes or decoded pixels',reader.stats.imageBytes===0&&reader.stats.imagePixels===0,{bytes:reader.stats.imageBytes,pixels:reader.stats.imagePixels});
    } finally {view.URL.createObjectURL=createURL;}
    const imageReads=[],manyImageBook=book('Images below fold',{html:'<img src="near.png" alt="Near"/><p style="height:2000px">Gap</p>'+Array.from({length:12},(_,index)=>'<img src="far-'+index+'.png" alt="Far"/><p style="height:2000px">Gap</p>').join('')});
    manyImageBook.readResource=async href=>{imageReads.push(href);return {mime:'image/png',data:pixel};};
    await reader.setBook(manyImageBook);for(let retry=0;retry<30&&!reader.root.querySelector('img');retry++)await pause();await pause();
    assert('below-fold images stay unread until near the viewport',JSON.stringify(imageReads)==='["near.png"]'&&reader.root.querySelectorAll('img').length===1,{resourceReads:imageReads.slice(),loadedImages:reader.root.querySelectorAll('img').length});
    assert('lazy image retention counts only the visible image',reader.stats.imagePixels===1&&reader.stats.imageBytes===pixel.byteLength,{pixels:reader.stats.imagePixels,bytes:reader.stats.imageBytes});
    const neighborReads=[],budgetBook={id:'continuous-dom-budget',title:'Continuous budget',chapters:[{title:'Current',href:'one.xhtml'},{title:'Large neighbor',href:'two.xhtml'}],async readChapter(index){neighborReads.push(index);const count=index?15000:10000;return {html:Array.from({length:count},(_,paragraph)=>'<p>Budget '+index+' '+paragraph+'</p>').join('')};}};
    reader.applyAppearance({...appearance,localTypography:'custom',continuousChapters:true});await reader.setBook(budgetBook);
    for(let retry=0;retry<30&&(!neighborReads.includes(1)||reader.stats.pendingChapterReads);retry++)await pause();await pause();
    assert('continuous prefetch skips a neighbor that would exceed the total DOM budget',neighborReads.includes(1)&&reader.stats.renderedChapters===1&&JSON.stringify(reader.stats.chapterIndexes)==='[0]'&&reader.stats.renderedNodes===10000&&!reader.root.querySelector('[data-wrp-chapter="1"]'),{readChapters:neighborReads.slice(),retainedChapters:reader.stats.chapterIndexes,nodes:reader.stats.renderedNodes});
    reader.applyAppearance(appearance);
    reader.applyAppearance({...appearance,literature:{enabled:true,paragraphs:3,english:'A neutral excerpt.'}});
    await reader.setBook(book('Wide literature table',{html:'<table><tr>'+Array.from({length:30},(_,index)=>'<td>Long table cell '+index+'</td>').join('')+'</tr></table>'}));await pause();
    const cardBody=reader.root.querySelector('.wrp-local-card-body');
    assert('wide card table has its own horizontal viewport',view.getComputedStyle(cardBody).overflowX==='auto'&&cardBody.scrollWidth>cardBody.clientWidth,{width:cardBody.clientWidth,scrollWidth:cardBody.scrollWidth});
    cardBody.scrollLeft=cardBody.scrollWidth;assert('wide table right edge remains reachable in literature cards',cardBody.scrollLeft>0,{scrollLeft:cardBody.scrollLeft});
    reader.applyAppearance(appearance);
    if(includeLarge){
      const count=150000,html=Array.from({length:count},(_,index)=>'<p>x'+index+'</p>').join(''),started=view.performance.now();
      assert('large fixture remains inside supported EPUB chapter byte budget',new TextEncoder().encode(html).length<16*1024*1024);
      const largeReads=[],largeAppearance={...appearance,continuousChapters:true},largeBook={id:'large-budget',title:'Large supported chapter',chapters:[{title:'Large active',href:'one.xhtml'},{title:'Neighbor',href:'two.xhtml'}],async readChapter(index){largeReads.push(index);return {html:index?'<p>Unneeded neighbor.</p>':html};}};
      reader.applyAppearance(largeAppearance);const loaded=await reader.setBook(largeBook);await pause();
      assert('150000-paragraph chapter opens without variadic append failure',loaded!==false&&reader.root.querySelectorAll('[data-wrp-paragraph]').length===count,{loaded,paragraphs:reader.root.querySelectorAll('[data-wrp-paragraph]').length,renderMilliseconds:Math.round(view.performance.now()-started)});
      assert('large chapter retains first and last paragraph',reader.root.querySelector('[data-wrp-paragraph="0"]').textContent==='x0'&&reader.root.querySelector('[data-wrp-paragraph="149999"]').textContent==='x149999');
      reader.applyAppearance({...largeAppearance,localTypography:'custom'});reader.applyAppearance(largeAppearance);await pause();
      assert('large chapter survives publisher tree restoration',reader.root.querySelectorAll('[data-wrp-paragraph]').length===count&&reader.root.querySelector('[data-wrp-paragraph="149999"]').textContent==='x149999');
      assert('large active chapter prevents neighbor reads before prefetch',JSON.stringify(largeReads)==='[0]'&&reader.stats.renderedChapters===1&&reader.stats.pendingChapterReads===0&&reader.stats.renderedNodes===count,{readChapters:largeReads.slice(),retainedChapters:reader.stats.chapterIndexes,nodes:reader.stats.renderedNodes});
    }
    assert('format operations do not report rendering errors',errors.length===0,{errors});report={passed:true,checks};
  } catch(error) {report={passed:false,error:error.message,checks};}
  finally {reader.destroy();host.remove();style.remove();}
  report.cleanup={surfaceRemoved:!reader.root.isConnected,hostRemoved:!host.isConnected,styleRemoved:!style.isConnected,imageBytes:reader.stats.imageBytes,imagePixels:reader.stats.imagePixels,renderedChapters:reader.stats.renderedChapters};return report;
})