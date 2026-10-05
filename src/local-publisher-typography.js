(function createLocalPublisherTypography(document) {
  const view=document.defaultView;
  const properties=new Set(('font font-family font-size font-style font-weight font-variant font-variant-caps font-stretch line-height text-indent text-align text-align-last text-decoration text-decoration-line text-decoration-style text-decoration-thickness text-underline-offset text-transform letter-spacing word-spacing white-space word-break overflow-wrap hyphens vertical-align margin margin-top margin-right margin-bottom margin-left margin-block margin-block-start margin-block-end margin-inline margin-inline-start margin-inline-end padding padding-top padding-right padding-bottom padding-left padding-block padding-inline border-width border-style border-top-width border-bottom-width border-left-width border-right-width border-radius list-style-type list-style-position display float clear width min-width max-width height min-height max-height box-sizing break-before break-after break-inside page-break-before page-break-after page-break-inside').split(' '));
  let serial=0;
  // A chapter's virtual html root owns rem sizing. Obsidian's document root
  // must never determine publisher dimensions or receive publisher styles.
  const remValue=(value,rootFont=false)=>{
    let output='',quote='';
    for(let index=0;index<value.length;) {
      const char=value[index];
      if(quote){output+=char;index++;if(char==='\\'&&index<value.length)output+=value[index++];else if(char===quote)quote='';continue;}
      if(char==='"'||char==="'"){quote=char;output+=char;index++;continue;}
      const match=(index===0||!/[\w.-]/.test(value[index-1]))&&value.slice(index).match(/^-?(?:\d*\.)?\d+rem\b/i);
      if(match){const number=Number(match[0].slice(0,-3));output+=rootFont?(number*16)+'px':'calc(var(--wrp-publisher-rem,16px)*'+number+')';index+=match[0].length;}
      else {output+=char;index++;}
    }
    return output;
  };
  const declarations=(style,rootFont=false)=>{
    const output=[];
    for(const name of style){
      const value=style.getPropertyValue(name);
      if(!properties.has(name)||value.length>512||/url\s*\(|expression\s*\(|image\s*\(|attr\s*\(|var\s*\(|[<>@]/i.test(value))continue;
      if([...value.matchAll(/(?:^|[^\w-])(-?\d+(?:\.\d+)?)/g)].some(match=>Math.abs(Number(match[1]))>2000))continue;
      if(name==='display'&&!/^(none|block|inline|inline-block|list-item|table|table-row|table-cell|flow-root)$/.test(value))continue;
      output.push(name+':'+remValue(value,rootFont&&(name==='font-size'||name==='font'))+(style.getPropertyPriority(name)==='important'?' !important':'')+';');
    }
    return output.join('');
  };
  const inline=(raw,rootFont)=>{const node=document.createElement('span');node.style.cssText=String(raw||'').slice(0,4096);return declarations(node.style,rootFont);};
  const attributes=(source,target,record)=>{
    const read=name=>source?.getAttribute?source.getAttribute(name):source?.[name==='class'?'className':name];
    const classes=String(read('class')||'').split(/\s+/).filter(value=>/^[a-zA-Z_][\w-]{0,127}$/.test(value)&&!value.startsWith('wrp-')).slice(0,32).join(' ');
    if(classes)target.dataset.wrpPublisherClass=classes;
    const id=String(read('id')||'').slice(0,128);if(/^[a-zA-Z_][\w-]*$/.test(id))target.dataset.wrpPublisherId=id;
    const lang=String(read('lang')||'').slice(0,32);if(/^[a-zA-Z][a-zA-Z-]*$/.test(lang))target.lang=lang;
    const value=inline(read('style'),target.hasAttribute('data-wrp-publisher-html'));if(value){target.dataset.wrpPublisherNode=String(++serial);record.publisherInline.push([target.dataset.wrpPublisherNode,value,target]);}
  };
  const selectors=value=>{
    const result=[];let start=0,depth=0,quote='';
    for(let i=0;i<=value.length;i++){
      const c=value[i];if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
      if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;
      if(i===value.length||(c===','&&depth===0)){result.push(value.slice(start,i).trim());start=i+1;}
    }
    return result.filter(Boolean);
  };
  const rewrite=selector=>{
    if(selector.length>512)return null;
    let output='';
    for(let index=0;index<selector.length;) {
      const char=selector[index];
      if(char==='[') {
        let end=index+1,quote='';
        for(;end<selector.length;end++) {
          const current=selector[end];
          if(quote){if(current==='\\')end++;else if(current===quote)quote='';}
          else if(current==='"'||current==="'")quote=current;
          else if(current===']')break;
        }
        if(end>=selector.length)return null;
        // Rewrite only the attribute name. Dots, hashes, commas and pseudo
        // names inside quoted values are literal text, not selector tokens.
        output+=selector.slice(index,end+1).replace(/^(\[\s*)(class|id)(?=[\s~|^$*=\]])/i,(_,prefix,name)=>prefix+'data-wrp-publisher-'+name.toLowerCase());
        index=end+1;continue;
      }
      if(char==='"'||char==="'") {
        let end=index+1;for(;end<selector.length;end++){if(selector[end]==='\\')end++;else if(selector[end]===char)break;}
        if(end>=selector.length)return null;output+=selector.slice(index,end+1);index=end+1;continue;
      }
      if(char==='\\'){output+=selector.slice(index,index+2);index+=2;continue;}
      if(/[{}@]/.test(char)||/^(?::host\b|:scope\b|::part\b|::slotted\b)/i.test(selector.slice(index)))return null;
      const identifier=selector.slice(index+(char==='.'||char==='#'?1:0)).match(/^[a-zA-Z_][\w-]*/);
      if((char==='.'||char==='#')&&identifier){output+='[data-wrp-publisher-'+(char==='.'?'class~':'id')+'="'+identifier[0]+'"]';index+=identifier[0].length+1;continue;}
      if(selector.slice(index).match(/^:root\b/i)){output+='[data-wrp-publisher-html]';index+=5;continue;}
      if(identifier&&(index===0||/[\s>+~,(]/.test(selector[index-1]))&&/^(html|body)$/i.test(identifier[0])){
        output+='[data-wrp-publisher-'+identifier[0].toLowerCase()+']';index+=identifier[0].length;continue;
      }
      output+=char;index++;
    }
    return output;
  };
  const compile=(texts,scope,record)=>{
    if(!view?.CSSStyleSheet)return '';
    const prefix='#'+scope;let rules=0,budget=0;
    const visit=list=>{
      let output='';for(const rule of list){if(++rules>2000)break;
        if(rule.type===1){
          for(const selector of selectors(rule.selectorText)){
            const value=rewrite(selector);if(!value)continue;let rootFont=false;
            try {rootFont=!!record.publisherHTML?.matches(value);}catch {continue;}
            const body=declarations(rule.style,rootFont);if(body)output+=prefix+' '+value+'{'+body+'}\n';
          }
        }
        else if((rule.type===4||rule.type===12)&&rule.cssRules){const condition=String(rule.conditionText||'');if(condition.length<=512&&!/[<>@]|url\s*\(/i.test(condition)){const body=visit(rule.cssRules);if(body)output+=(rule.type===4?'@media ':'@supports ')+condition+'{'+body+'}\n';}}
      }return output;
    };
    let output='';for(const text of texts||[]){if(typeof text!=='string'||(budget+=text.length)>524288)break;try{const sheet=new view.CSSStyleSheet();sheet.replaceSync(text);output+=visit(sheet.cssRules);}catch(_){/* A broken publisher rule cannot prevent reading. */}}
    return output;
  };
  const refresh=record=>{
    if(!record.publisherRoot?.isConnected||!record.publisherHTML||!view?.getComputedStyle)return;
    const font=parseFloat(view.getComputedStyle(record.publisherHTML).fontSize);
    const value=(Number.isFinite(font)&&font>0&&font<=2000?font:16)+'px';
    if(record.publisherRoot.style.getPropertyValue('--wrp-publisher-rem')!==value)record.publisherRoot.style.setProperty('--wrp-publisher-rem',value);
  };
  return {attributes,compile,refresh};
})