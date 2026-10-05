(function createLocalPublisherTypography(document) {
  const view=document.defaultView;
  const properties=new Set(('font font-family font-size font-style font-weight font-variant font-variant-caps font-stretch line-height text-indent text-align text-align-last text-decoration text-decoration-line text-decoration-style text-decoration-thickness text-underline-offset text-transform letter-spacing word-spacing white-space word-break overflow-wrap hyphens vertical-align margin margin-top margin-right margin-bottom margin-left margin-block margin-block-start margin-block-end margin-inline margin-inline-start margin-inline-end padding padding-top padding-right padding-bottom padding-left padding-block padding-inline border-width border-style border-top-width border-bottom-width border-left-width border-right-width border-radius list-style-type list-style-position display float clear width min-width max-width height min-height max-height box-sizing break-before break-after break-inside page-break-before page-break-after page-break-inside').split(' '));
  let serial=0;
  const declarations=style=>{
    const output=[];
    for(const name of style){
      const value=style.getPropertyValue(name);
      if(!properties.has(name)||value.length>512||/url\s*\(|expression\s*\(|image\s*\(|attr\s*\(|var\s*\(|[<>@]/i.test(value))continue;
      if([...value.matchAll(/(?:^|[^\w-])(-?\d+(?:\.\d+)?)/g)].some(match=>Math.abs(Number(match[1]))>2000))continue;
      if(name==='display'&&!/^(none|block|inline|inline-block|list-item|table|table-row|table-cell|flow-root)$/.test(value))continue;
      output.push(name+':'+value+(style.getPropertyPriority(name)==='important'?' !important':'')+';');
    }
    return output.join('');
  };
  const inline=raw=>{const node=document.createElement('span');node.style.cssText=String(raw||'').slice(0,4096);return declarations(node.style);};
  const attributes=(source,target,record)=>{
    const read=name=>source?.getAttribute?source.getAttribute(name):source?.[name==='class'?'className':name];
    const classes=String(read('class')||'').split(/\s+/).filter(value=>/^[a-zA-Z_][\w-]{0,127}$/.test(value)&&!value.startsWith('wrp-')).slice(0,32).join(' ');
    if(classes)target.dataset.wrpPublisherClass=classes;
    const id=String(read('id')||'').slice(0,128);if(/^[a-zA-Z_][\w-]*$/.test(id))target.dataset.wrpPublisherId=id;
    const lang=String(read('lang')||'').slice(0,32);if(/^[a-zA-Z][a-zA-Z-]*$/.test(lang))target.lang=lang;
    const value=inline(read('style'));if(value){target.dataset.wrpPublisherNode=String(++serial);record.publisherInline.push([target.dataset.wrpPublisherNode,value,target]);}
  };
  const selectors=value=>{
    const result=[];let start=0,depth=0,quote=null;
    for(let i=0;i<=value.length;i++){
      const c=value[i];if(quote){if(c===quote&&value[i-1]!=='\\')quote=null;continue;}
      if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;
      if(i===value.length||(c===','&&depth===0)){result.push(value.slice(start,i).trim());start=i+1;}
    }
    return result.filter(Boolean);
  };
  const rewrite=selector=>{
    if(selector.length>512||/:host|:scope|::part|::slotted|[{}@]/i.test(selector))return null;
    return selector.replace(/:root\b/g,'[data-wrp-publisher-html]')
      .replace(/(^|[\s>+~,(])html(?=$|[\s.#:\[>+~,)])/gi,'$1[data-wrp-publisher-html]')
      .replace(/(^|[\s>+~,(])body(?=$|[\s.#:\[>+~,)])/gi,'$1[data-wrp-publisher-body]')
      .replace(/#([a-zA-Z_][\w-]*)/g,'[data-wrp-publisher-id="$1"]')
      .replace(/\.([a-zA-Z_][\w-]*)/g,'[data-wrp-publisher-class~="$1"]')
      .replace(/\[class(?=[\s~|^$*=\]])/g,'[data-wrp-publisher-class').replace(/\[id(?=[\s~|^$*=\]])/g,'[data-wrp-publisher-id');
  };
  const compile=(texts,scope,record)=>{
    if(!view?.CSSStyleSheet)return '';
    const prefix='#'+scope;let rules=0,budget=0;
    const visit=list=>{
      let output='';for(const rule of list){if(++rules>2000)break;
        if(rule.type===1){const body=declarations(rule.style);if(!body)continue;const items=selectors(rule.selectorText).map(rewrite).filter(Boolean).map(value=>prefix+' '+value);if(items.length)output+=items.join(',')+'{'+body+'}\n';}
        else if((rule.type===4||rule.type===12)&&rule.cssRules){const condition=String(rule.conditionText||'');if(condition.length<=512&&!/[<>@]|url\s*\(/i.test(condition)){const body=visit(rule.cssRules);if(body)output+=(rule.type===4?'@media ':'@supports ')+condition+'{'+body+'}\n';}}
      }return output;
    };
    let output='';for(const text of texts||[]){if(typeof text!=='string'||(budget+=text.length)>524288)break;try{const sheet=new view.CSSStyleSheet();sheet.replaceSync(text);output+=visit(sheet.cssRules);}catch(_){/* A broken publisher rule cannot prevent reading. */}}
    return output;
  };
  return {attributes,compile};
})
