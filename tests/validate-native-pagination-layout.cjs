'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../src/native-reader-bridge.js', 'utf8');
const marker = source.split('  // WRP_PAGED_INSETS_START\n')[1]?.split('  // WRP_PAGED_INSETS_END')[0];
assert.ok(marker, 'Native pagination geometry helper must be available');
const geometry = vm.runInNewContext('(()=>{' + marker + ';return nativePagedInsets;})()');
const rect = (top, height, width=448) => ({top,bottom:top+height,height,width});
const checks=[];
async function check(name, fn) {try {await fn();checks.push({name,pass:true});} catch(error) {checks.push({name,pass:false,error:error.message});}}
function harness({height=391,origin=0,width=480,header=rect(origin+4,24),pager=rect(origin+height-56,32),legacy=false}={}) {
  const options={canvasTop:72,canvasBottom:50,canvasXAround:64,canvasXBetween:50},changes=[],events=[],hooks={},head={appendChild(){}};
  const store={state:{readerRender:options},_actions:{modifyCanvasOptions:[()=>{}]},dispatch(name,payload){assert.equal(name,'modifyCanvasOptions');changes.push({...payload});Object.assign(options,payload);return Promise.resolve();}};
  const chapter={clientWidth:width,getBoundingClientRect:()=>rect(origin,height,width)};
  const reader={$options:{name:legacy?'LegacyReader':'HorizontalReader'},$store:store,$parent:{handleSwitchMode(){}},$refs:{},currentChapter:{chapterUid:1},chapterContentState:'DONE',$watch(){return()=>{}},$once(name,fn){hooks[name]=fn}};
  if(legacy)reader.findObjsWithPoints=()=>[];
  const document={head,documentElement:head,body:{classList:{contains:()=>false,remove(){}}},addEventListener(){},removeEventListener(){},querySelector(selector){return selector==='.wr_horizontalReader .readerChapterContent'?chapter:selector==='.wr_horizontalReader'?{}:null;},querySelectorAll(selector){return (selector.includes('header')?[header]:[pager]).filter(Boolean).map(box=>({getBoundingClientRect:()=>box}));}};
  const window={innerWidth:width,dispatchEvent(event){events.push(event.type);}};
  const context=vm.createContext({window,document,Event:class {constructor(type){this.type=type;}},setTimeout(){return 1;},clearTimeout(){},__reader:reader,console});
  vm.runInContext(source+'\n__bound=bindNativeReader.call(__reader);',context,{timeout:1000});
  assert.equal(context.__bound,true);
  return {window,reader,chapter,options,changes,events,hooks};
}
(async()=>{
  await check('Dock page headings and native 32px pagers have separate reserved text regions',()=>{
    const page=rect(0,391,480),header=rect(4,24),pager=rect(335,32),insets=geometry(page,[header],[pager]);
    assert.equal(insets.canvasTop,40);assert.equal(insets.canvasBottom,64);
    assert.equal(page.top+insets.canvasTop-header.bottom,12);
    assert.equal(pager.top-(page.bottom-insets.canvasBottom),8);
    assert.ok(page.height-insets.canvasTop-insets.canvasBottom>=280);
  });
  await check('Measured oversized native header and pager expand the reserves instead of covering text',()=>{
    const page=rect(51.25,430.5,320),header=rect(55.25,41.5,288),pager=rect(399.5,32,288),insets=geometry(page,[header],[pager]);
    assert.ok(page.top+insets.canvasTop>=header.bottom+8);
    assert.ok(page.bottom-insets.canvasBottom<=pager.top-8);
    assert.ok(Number.isInteger(insets.canvasTop)&&Number.isInteger(insets.canvasBottom));
  });
  await check('Hidden and off-page controls cannot steal space from the current page',()=>{
    const page=rect(0,391),insets=geometry(page,[rect(500,40),rect(0,0),rect(2,24,0)],[rect(-80,32),rect(0,0)]);
    assert.equal(insets.canvasTop,40);assert.equal(insets.canvasBottom,64);
  });
  await check('Short guests retain readable text after hiding their repeated page heading',()=>{
    for(const height of [120,140,160]) {const insets=geometry(rect(0,height),[],[rect(height-56,32)]);assert.equal(insets.canvasTop,12);assert.equal(insets.canvasBottom,64);assert.ok(height-insets.canvasTop-insets.canvasBottom>=44);}
  });
  await check('Native one and two-column windows reserve the same vertical space at fractional zoom',()=>{
    for(const width of [240,320,480,800,1100,1500])for(const height of [180.25,280.5,391.111,720.75]){
      const page=rect(13.375,height,width),head=rect(17.375,24,width-32),pager=rect(page.bottom-56,32,width-32),insets=geometry(page,[head],[pager]);
      assert.ok(page.top+insets.canvasTop-head.bottom>=8);assert.ok(pager.top-(page.bottom-insets.canvasBottom)>=8);assert.ok(height-insets.canvasTop-insets.canvasBottom>0);
    }
  });
  await check('Invalid detached page geometry is rejected before official canvas options change',()=>{
    for(const value of [{height:0,top:0},{height:NaN,top:0},{height:Infinity,top:0},{height:391,top:undefined}])assert.equal(geometry(value),null);
    const h=harness({height:0});assert.equal(h.window.__wrpApplyNativePadding(16,true,true),false);assert.equal(h.changes.length,0);
  });
  await check('Native padding uses measured bars, redraws once, and remains stable for repeated applications',async()=>{
    const h=harness();assert.equal(h.window.__wrpApplyNativePadding(16,true,true),true);await Promise.resolve();
    assert.deepEqual(h.changes,[{canvasXAround:16,canvasTop:40,canvasBottom:64}]);assert.deepEqual(h.events,['resize']);
    assert.equal(h.window.__wrpApplyNativePadding(16,true,true),true);await Promise.resolve();assert.equal(h.changes.length,1);assert.equal(h.events.length,1);
  });
  await check('Moving between compact and wide guests keeps the bars out of the native text area',async()=>{
    const h=harness({width:1280,origin:80,height:680,header:rect(84,24,1000),pager:rect(704,32,1000)});
    assert.equal(h.window.__wrpApplyNativePadding(64,false,true),true);await Promise.resolve();assert.equal(h.options.canvasTop,40);assert.equal(h.options.canvasBottom,64);assert.equal(h.options.canvasXAround,64);
    assert.equal(h.window.__wrpApplyNativePadding(64,true,true),true);await Promise.resolve();assert.equal(h.changes.length,1,'Window presentation alone cannot redraw unchanged geometry');
  });
  await check('Continuous scrolling leaves native pagination options unchanged',async()=>{
    const h=harness({legacy:true});assert.equal(h.window.__wrpApplyNativePadding(16,true,true),true);await Promise.resolve();assert.equal(h.changes.length,0);assert.equal(h.options.canvasTop,72);assert.equal(h.options.canvasBottom,50);
  });
  await check('Destroying the native reader prevents a delayed redraw',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(16,true,true);h.hooks['hook:beforeDestroy']();await Promise.resolve();assert.equal(h.events.length,0);assert.equal(h.window.__wrpApplyNativePadding(16,true,true),false);
  });
  console.log(JSON.stringify({checks},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
