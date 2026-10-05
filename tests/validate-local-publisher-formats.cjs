'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/local-publisher-typography.js'),'utf8');
const factory=vm.runInNewContext(source);new vm.Script(fs.readFileSync(path.join(__dirname,'local-publisher-format-browser.js'),'utf8'));new vm.Script(fs.readFileSync(path.join(__dirname,'local-reader-format-browser.js'),'utf8'));
const style=values=>Object.assign(Object.keys(values),{getPropertyValue:name=>values[name]||'',getPropertyPriority:()=>''});
const fixtures=new Map();
class Sheet {replaceSync(text){this.cssRules=fixtures.get(text)||[];}}
let rootFont='24px';const document={defaultView:{CSSStyleSheet:Sheet,getComputedStyle:()=>({fontSize:rootFont})},createElement:()=>({style:Object.assign([],{
  set cssText(raw){this.splice(0);this.values={};for(const declaration of raw.split(';')){const colon=declaration.indexOf(':');if(colon<0)continue;const name=declaration.slice(0,colon).trim();this.values[name]=declaration.slice(colon+1).trim();this.push(name);}},
  getPropertyValue(name){return this.values?.[name]||'';},getPropertyPriority:()=>''
})})};
const typography=factory(document),variables=new Map(),record={publisherHTML:{matches:selector=>selector==='[data-wrp-publisher-html]'},publisherRoot:{isConnected:true,style:{getPropertyValue:name=>variables.get(name)||'',setProperty:(name,value)=>variables.set(name,value)}},publisherInline:[]};
const fixture=(name,rules)=>{fixtures.set(name,rules.map(([selectorText,values])=>({type:1,selectorText,style:style(values)})));return typography.compile([name],'test-scope',record);};
let css=fixture('literal-selectors',[
 ['p.quoted:not([class~="foo.bar"])',{'font-size':'29px'}],
 ['p.literal:not([id="a#b,c.html"])',{'font-size':'31px'}],
 ['p.hash:not([class="x:host.y"])',{'font-size':'33px'}],
 ['p.first,p.second:not([class="quoted,comma"])',{'margin-left':'.5rem'}]
]);
assert.match(css,/\[data-wrp-publisher-class~="foo\.bar"\]/);assert.match(css,/\[data-wrp-publisher-id="a#b,c\.html"\]/);
assert.match(css,/x:host\.y/);assert.equal((css.match(/\{margin-left:/g)||[]).length,2,'Selector commas inside attribute values do not create extra rules');
assert(css.split('\n').filter(Boolean).every(rule=>rule.startsWith('#test-scope ')),'All rules are confined to their chapter');
css=fixture('rem-roots',[[":root,p.note",{'font-size':'1.5rem','margin-left':'.5rem','font-family':'"Book 1rem"'}]]);
assert.match(css,/#test-scope \[data-wrp-publisher-html\]\{font-size:24px;/);
assert.match(css,/p\[data-wrp-publisher-class~="note"\]\{font-size:calc\(var\(--wrp-publisher-rem,16px\)\*1\.5\);/);
assert.match(css,/margin-left:calc\(var\(--wrp-publisher-rem,16px\)\*0\.5\);/);assert.match(css,/font-family:"Book 1rem"/,'Quoted font names are never converted as lengths');
css=fixture('inert-properties',[["p.safe",{'font-size':'20px','color':'red','position':'fixed','background-image':'url(https://invalid.example/x)'}],[":scope p",{'font-size':'99px'}],[":host",{'font-size':'88px'}]]);
assert.match(css,/font-size:20px/);assert.doesNotMatch(css,/color:|position:|url\(|99px|88px/);
typography.refresh(record);assert.equal(variables.get('--wrp-publisher-rem'),'24px');rootFont='20.5px';typography.refresh(record);assert.equal(variables.get('--wrp-publisher-rem'),'20.5px');
record.publisherRoot.isConnected=false;rootFont='100px';typography.refresh(record);assert.equal(variables.get('--wrp-publisher-rem'),'20.5px','Detached chapters do not read application typography');
console.log('PASS publisher format regressions: quoted selector literals, safe chapter scope, per-book rem basis, inline/root sizing contract, and detached refresh guard. Browser fixture covers 12 computed-layout checks.');