'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const styles=()=>{const values=new Map();return {cssText:'',getPropertyValue:name=>values.get(name)?.value||'',getPropertyPriority:name=>values.get(name)?.priority||'',setProperty(name,value,priority=''){values.set(name,{value,priority});},removeProperty:name=>values.delete(name)};};
class Element {
 constructor(tag='div'){Object.assign(this,{tagName:tag,children:[],parentElement:null,isConnected:true,clientWidth:400,style:styles(),dataset:{},paragraphs:[]});}
 appendChild(node){node.remove();node.parentElement=this;node.isConnected=true;this.children.push(node);return node;}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;this.isConnected=false;}
 querySelector(){return null;}
 querySelectorAll(selector){assert.equal(selector,'p');return this.paragraphs;}
 getBoundingClientRect(){const height=18+parseFloat(this.style.getPropertyValue('padding-top')||0)+parseFloat(this.style.getPropertyValue('padding-bottom')||0);return {left:0,right:400,top:0,bottom:height,width:400,height};}
}
const factory=vm.runInNewContext(fs.readFileSync(__dirname+'/../src/create-literature-cards.js','utf8')+';createLiteratureCards',{document:{},getComputedStyle:()=>({fontSize:'14px',lineHeight:'18.2px',fontFamily:'sans-serif',fontWeight:'400',borderLeftWidth:'1px',borderBottomWidth:'1px'})});
const checks=[];
for(const variant of ['dom','content-vue','content-array','root-vue','root-array','target-vue','target-array','missing-content','missing-root','missing-target','invalid-vue-content','detached-array-entry']) {
 const root=new Element(),content=new Element(),target=new Element(),paragraph=new Element('p'),chapter=new Element();
 content.paragraphs=[paragraph];root.paragraphs=[paragraph];root.querySelector=s=>s==='.preRenderContent'?content:null;
 chapter.querySelector=s=>s==='.preRenderContainer'?root:s==='.renderTargetContainer'?target:null;
 const reader={$refs:{preRenderContainer:root,preRenderContent:content,renderTargetContainer:target,readerChapterContent:chapter},renderContentsVersion:1,chapterContentState:'DONE'};
 if(variant==='content-vue')reader.$refs.preRenderContent={$el:content};
 if(variant==='content-array')reader.$refs.preRenderContent=[{},{$el:content}];
 if(variant==='root-vue')reader.$refs.preRenderContainer={$el:root};
 if(variant==='root-array')reader.$refs.preRenderContainer=[{},{$el:root}];
 if(variant==='target-vue')reader.$refs.renderTargetContainer={$el:target};
 if(variant==='target-array')reader.$refs.renderTargetContainer=[{},{$el:target}];
 if(variant==='missing-content'){delete reader.$refs.preRenderContent;root.querySelector=()=>null;}
 if(variant==='missing-root')delete reader.$refs.preRenderContainer;
 if(variant==='missing-target')delete reader.$refs.renderTargetContainer;
 if(variant==='invalid-vue-content')reader.$refs.preRenderContent={$el:{},querySelectorAll:'not a DOM method'};
 if(variant==='detached-array-entry'){const detached=new Element();detached.isConnected=false;reader.$refs.preRenderContainer=[detached,{$el:root}];reader.$refs.renderTargetContainer=[detached,target];}
 const body=new Element('body'),document={body,createElement:tag=>new Element(tag),querySelector:s=>s.includes('preRenderContainer')?root:s.includes('renderTargetContainer')?target:null};
 const cards=factory({reader,chapterKey:()=> 'book:1',getParagraphSpacing:()=>4,getConfig:()=>({enabled:true,english:'A custom literature quote.',paragraphs:3}),eventDocument:document});
 assert.doesNotThrow(()=>cards.prepare(),variant);assert(parseFloat(paragraph.style.getPropertyValue('padding-top'))>0,variant+' reserves space using actual DOM paragraphs');cards.collected('book:1',1);
 assert.equal(target.children.length,1,variant+' draws into a validated DOM target');assert.equal(target.children[0].children.length,1);cards.clear();assert.equal(target.children.length,0);assert.equal(paragraph.style.getPropertyValue('padding-top'),'');assert.equal(body.children.length,0,'Measurement element is removed');cards.dispose();checks.push(variant);
}
for(const variant of ['no-refs','invalid-refs','detached-refs']) {
 const root=new Element();root.isConnected=variant!=='detached-refs';const reader={$refs:variant==='no-refs'?{}:variant==='invalid-refs'?{preRenderContainer:{},preRenderContent:[{}],renderTargetContainer:{$el:{}}}:{preRenderContainer:root,preRenderContent:root,renderTargetContainer:root},renderContentsVersion:1,chapterContentState:'DONE'};
 const body=new Element('body'),document={body,createElement:tag=>new Element(tag),querySelector:()=>null};const cards=factory({reader,chapterKey:()=> 'book:1',getParagraphSpacing:()=>4,getConfig:()=>({enabled:true,english:'A quote.',paragraphs:3}),eventDocument:document});
 assert.doesNotThrow(()=>cards.prepare(),variant);assert.doesNotThrow(()=>cards.collected('book:1',1),variant);assert.equal(body.children.length,0);assert.equal(root.children.length,0);cards.dispose();checks.push(variant);
}
console.log(JSON.stringify({pass:true,checks},null,2));
