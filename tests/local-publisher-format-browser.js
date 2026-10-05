(async function validateLocalPublisherFormats({document,factory}) {
  const checks=[],assert=(name,passed,detail)=>checks.push({name,pass:!!passed,detail});
  const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;top:0;width:520px;height:400px';document.body.append(frame);
  try {
    const doc=frame.contentDocument,view=doc.defaultView,typography=factory(doc);
    doc.documentElement.style.fontSize='48px';
    const outside=doc.createElement('p');outside.textContent='Outside typography';outside.style.fontSize='17px';doc.body.append(outside);
    const root=doc.createElement('div');root.id='wrp-publisher-format-fixture';root.style.cssText='font-size:16px;line-height:1.5';doc.body.append(root);
    const html=doc.createElement('wrp-publisher-html'),body=doc.createElement('wrp-publisher-body');html.dataset.wrpPublisherHtml='';body.dataset.wrpPublisherBody='';html.style.display='block';body.style.display='block';html.append(body);root.append(html);
    const record={publisherRoot:root,publisherHTML:html,publisherInline:[]};
    const nodes=new Map();
    const append=(id,className,attributes={})=>{const source=doc.createElement('p'),target=doc.createElement('p');source.id=id;source.className=className;for(const [name,value] of Object.entries(attributes))source.setAttribute(name,value);typography.attributes(source,target,record);target.textContent=id+' 中文 text';target.dataset.test=id;body.append(target);nodes.set(id,target);return target;};
    append('rem','rem');append('quoted','quoted');append('literal','literal');append('hash','hash');append('mixed','mixed');append('inline','inline',{style:'font-size:1.25rem;margin-left:.5rem'});
    const style=doc.createElement('style');root.prepend(style);
    style.textContent=typography.compile(['html {font-size:24px} p.rem {font-size:1rem;margin-left:.5rem} p.quoted:not([class~="foo.bar"]) {font-size:29px} p.literal:not([id="a#b,c.html"]) {font-size:31px} p.hash:not([class="x:host.y"]) {font-size:33px} html,p.mixed {font-size:1.5rem}'],root.id,record);
    for(const [,value,target] of record.publisherInline)target.style.cssText=value;
    typography.refresh(record);
    const size=id=>parseFloat(view.getComputedStyle(nodes.get(id)).fontSize);
    assert('publisher rem follows book root independently of application root',size('rem')===24,{actual:size('rem'),applicationRoot:48,bookRoot:24});
    assert('rem lengths retain fractional dimensions',parseFloat(view.getComputedStyle(nodes.get('rem')).marginLeft)===12);
    assert('quoted dot literal survives class rewriting',size('quoted')===29);
    assert('quoted hash and comma survive selector splitting',size('literal')===31);
    assert('quoted pseudo-name is literal rather than rejected',size('hash')===33);
    assert('mixed root/content rule uses correct independent rem basis',parseFloat(view.getComputedStyle(html).fontSize)===24&&size('mixed')===36,{root:view.getComputedStyle(html).fontSize,content:size('mixed')});
    assert('publisher inline rem uses virtual root',size('inline')===30&&parseFloat(view.getComputedStyle(nodes.get('inline')).marginLeft)===12);
    assert('publisher CSS stays scoped',parseFloat(view.getComputedStyle(outside).fontSize)===17);
    const compiled=style.textContent;
    assert('literal values remain byte-for-byte intact',compiled.includes('foo.bar')&&compiled.includes('a#b,c.html')&&compiled.includes('x:host.y'));
    style.textContent=typography.compile(['html {font-size:20px} p.rem {font-size:1rem} p.inline {font-size:2rem}'],root.id,record);typography.refresh(record);
    assert('refresh responds to root typography changes',size('rem')===20&&size('inline')===25,{root:view.getComputedStyle(html).fontSize,rem:size('rem'),inline:size('inline')});
    typography.refresh(record);assert('refresh does not compound root rem',parseFloat(view.getComputedStyle(html).fontSize)===20);
    style.textContent=typography.compile(['html {font:normal 2rem/1.5 serif} p.rem {font-size:1rem}'],root.id,record);typography.refresh(record);
    assert('root font shorthand rem uses publisher initial font',parseFloat(view.getComputedStyle(html).fontSize)===32&&size('rem')===32,{root:view.getComputedStyle(html).fontSize,rem:size('rem')});
    return {passed:checks.every(check=>check.pass),checks};
  } finally {frame.remove();}
})