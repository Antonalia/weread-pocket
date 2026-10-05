(function installLocalBooks(Pocket, dependencies) {
  const {Modal, Setting, Notice, Menu, createLocalBookStore, createLocalReaderSurface, createLocalBookSearch} = dependencies;
  const supported = /\.(epub|txt)$/i;
  const libraryFolder = 'WeRead Pocket';
  let nodePath, fileSystem;
  const initializeNode = () => {nodePath ||= require('path');fileSystem ||= require('fs');};
  const canonical = value => {initializeNode();return nodePath.resolve(value).toLocaleLowerCase();};
  const inside = (parent, child) => {initializeNode();const relative=nodePath.relative(parent,child);return relative===''||(!relative.startsWith('..'+nodePath.sep)&&relative!=='..'&&!nodePath.isAbsolute(relative));};
  const isManagedRelative = value => typeof value==='string' && value.startsWith(libraryFolder+'/') && supported.test(value) && !/[\\\0]/.test(value) && !value.split('/').some(part=>part==='..'||part.toLowerCase()==='.obsidian'||!part);
  const isLibraryRelative = value => value===libraryFolder || (typeof value==='string' && value.startsWith(libraryFolder+'/') && !/[\\\0]/.test(value) && !value.split('/').some(part=>part==='..'||part.toLowerCase()==='.obsidian'||!part));
  const preserveId = (value, path) => typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value)?value:idFor(path);
  async function libraryContext(plugin, create=true) {
    initializeNode();
    const adapter=plugin.app?.vault?.adapter;
    if(typeof adapter?.getBasePath!=='function')throw new Error('本地书架需要桌面版文件仓库');
    const base=nodePath.resolve(adapter.getBasePath()), realBase=await fileSystem.promises.realpath(base), folder=nodePath.join(base,libraryFolder);
    if(!inside(base,folder))throw new Error('图书文件夹路径无效');
    let info;try{info=await fileSystem.promises.lstat(folder);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(info&&!info.isDirectory())throw new Error('WeRead Pocket 已存在，请将同名文件或链接移开');
    if(info?.isSymbolicLink())throw new Error('图书文件夹不能使用链接');
    if(!info&&create) {
      if(typeof plugin.app.vault.createFolder==='function')await plugin.app.vault.createFolder(libraryFolder);
      else await fileSystem.promises.mkdir(folder);
    }
    const realFolder=await fileSystem.promises.realpath(folder);
    if(!inside(realBase,realFolder)||canonical(realFolder)!==canonical(nodePath.join(realBase,libraryFolder)))throw new Error('图书文件夹必须位于仓库根目录内');
    return {base,realBase,folder,realFolder};
  }
  function vaultPath(context, absolute) {return nodePath.relative(context.base,absolute).split(nodePath.sep).join('/');}
  async function managedPath(plugin, source, context) {
    if(typeof source!=='string'||source.length>=32768||!supported.test(source))throw new Error('目前支持 EPUB 和 TXT');
    const absolute=nodePath.resolve(source), stat=await fileSystem.promises.stat(absolute);
    if(!stat.isFile())throw new Error('请选择有效的图书文件');
    const realSource=await fileSystem.promises.realpath(absolute);
    if(inside(context.folder,absolute)) {
      if(!inside(context.realFolder,realSource))throw new Error('图书文件不能链接到仓库外');
      return {path:absolute,sourcePath:'',copied:false};
    }
    const name=nodePath.basename(absolute), extension=nodePath.extname(name), stem=name.slice(0,-extension.length);
    for(let number=1;number<=10000;number++) {
      const destination=nodePath.join(context.folder,number===1?name:stem+' ('+number+')'+extension);
      if(!inside(context.folder,destination))throw new Error('图书文件名无效');
      try {await fileSystem.promises.copyFile(absolute,destination,fileSystem.constants.COPYFILE_EXCL);return {path:destination,sourcePath:absolute,copied:true};}
      catch(error) {if(error.code!=='EEXIST')throw error;}
    }
    throw new Error('同名图书过多，请换一个文件名');
  }
  function placeholder(path) {return {id:idFor(path),path,title:nodePath.basename(path,nodePath.extname(path)),author:'',format:/\.epub$/i.test(path)?'EPUB':'TXT',addedAt:Date.now(),lastOpened:0,progress:progressOf(null)};}
  function excludePath(plugin, context, path, excluded) {
    const relative=vaultPath(context,path);if(!isManagedRelative(relative))return;
    const values=new Set(plugin.settings.localExcludedPaths||[]);
    if(excluded)values.add(relative);else values.delete(relative);
    plugin.settings.localExcludedPaths=[...values];
  }
  async function scanLibrary(plugin, context) {
    if(plugin.localLibraryImportActive)return 0;
    let added=0;const excluded=new Set(plugin.settings.localExcludedPaths||[]);
    for(const file of plugin.app.vault.getFiles()) {
      if(plugin.localLibraryImportActive)return added;
      if(!isManagedRelative(file.path)||excluded.has(file.path))continue;
      const absolute=nodePath.resolve(context.base,...file.path.split('/'));
      if(!inside(context.folder,absolute))continue;
      try {const real=await fileSystem.promises.realpath(absolute);if(!inside(context.realFolder,real))continue;}
      catch {continue;}
      if(plugin.settings.localBooks.some(entry=>canonical(entry.path)===canonical(absolute)))continue;
      plugin.settings.localBooks.push(placeholder(absolute));added++;
    }
    return added;
  }
  const idFor = path => require('crypto').createHash('sha256').update(require('path').resolve(path).toLowerCase()).digest('hex').slice(0,24);
  const progressOf = value => ({chapter:Math.max(0,Math.floor(Number(value?.chapter)||0)),paragraph:Math.max(0,Math.floor(Number(value?.paragraph)||0)),offset:Math.max(0,Math.min(1,Number(value?.offset)||0)),percent:Math.max(0,Math.min(100,Number(value?.percent)||0))});
  const bookmarkLimit = 500;
  const bookmarksOf = values => (Array.isArray(values) ? values : []).slice(0, bookmarkLimit).filter(value => value && typeof value.id === 'string' && /^[a-f0-9]{24}$/i.test(value.id)).map(value => {
    const finite = (number, maximum) => Number.isFinite(Number(number)) ? Math.max(0, Math.min(maximum, Number(number))) : 0;
    return {id:value.id, chapter:Math.floor(finite(value.chapter, 10000000)), paragraph:Math.floor(finite(value.paragraph, 10000000)), offset:finite(value.offset, 1), percent:finite(value.percent, 100),
      name:String(value.name || '').slice(0, 120), excerpt:String(value.excerpt || '').slice(0, 160), createdAt:finite(value.createdAt, 8640000000000000)};
  });
  function normalizeLibrary(settings) {
    initializeNode();
    const seen = new Set();
    settings.localBooks = (Array.isArray(settings.localBooks) ? settings.localBooks : []).filter(entry => entry && typeof entry.path==='string' && supported.test(entry.path) && entry.path.length<32768).map(entry => {
      const id = preserveId(entry.id,entry.path), key=canonical(entry.path);
      if(seen.has(key)) return null;
      seen.add(key);
      return {id,path:entry.path,sourcePath:typeof entry.sourcePath==='string'&&supported.test(entry.sourcePath)&&entry.sourcePath.length<32768?entry.sourcePath:'',title:String(entry.title||require('path').basename(entry.path)).slice(0,240),author:String(entry.author||'').slice(0,240),format:/\.epub$/i.test(entry.path)?'EPUB':'TXT',addedAt:Number(entry.addedAt)||Date.now(),lastOpened:Number(entry.lastOpened)||0,progress:progressOf(entry.progress),bookmarks:bookmarksOf(entry.bookmarks)};
    }).filter(Boolean);
    settings.localTypography = settings.localTypography === 'custom' ? 'custom' : 'publisher';
    settings.continuousChapters = settings.continuousChapters!==false;
    settings.localExcludedPaths = (Array.isArray(settings.localExcludedPaths)?settings.localExcludedPaths:[]).filter(isManagedRelative);
    settings.localLibraryFolder = libraryFolder;
    settings.readingSource = settings.readingSource==='local' ? 'local' : 'weread';
    settings.localLastBook = typeof settings.localLastBook==='string' ? settings.localLastBook : '';
  }
  class LocalShelf extends (Modal || class {}) {
    constructor(plugin, vaultPicker=false) {super(plugin.app);this.plugin=plugin;this.vaultPicker=vaultPicker;}
    onOpen() {this.render();}
    render() {
      const p=this.plugin, el=this.contentEl;el.empty();el.addClass('wrp-local-shelf');
      el.createEl('h2',{text:this.vaultPicker?'从仓库添加图书':'本地书架'});
      const sources=el.createDiv({cls:'wrp-shelf-actions'});
      const action=(label,callback,cta=false)=>{const button=sources.createEl('button',{text:label,attr:{type:'button'}});if(cta)button.addClass('mod-cta');button.addEventListener('click',callback);return button;};
      action('微信读书',()=>{p.useWeReadSource();this.close();});
      action(this.vaultPicker?'返回本地书架':'添加 EPUB / TXT',async()=>{if(this.vaultPicker){this.vaultPicker=false;this.render();}else {await p.importLocalFiles();if(this.contentEl.isConnected)this.render();}},true);
      if(!this.vaultPicker){action('从仓库添加',()=>{this.vaultPicker=true;this.render();});action('打开书籍文件夹',()=>p.revealLocalLibraryFolder());}
      el.createEl('p',{cls:'wrp-shelf-note',text:this.vaultPicker?'选择仓库中的 EPUB 或 TXT。不会接管其他插件的文件打开方式。':'图书保存到仓库的 WeRead Pocket 文件夹。移出书架只移除记录，保留图书文件。'});
      const filters=el.createDiv({cls:'wrp-shelf-filters'}), search=filters.createEl('input',{type:'search',attr:{placeholder:'搜索书名、作者','aria-label':'搜索本地图书'}});
      const sort=filters.createEl('select',{attr:{'aria-label':'书架排序'}});
      for(const [value,label] of [['recent','最近阅读'],['title','书名'],['added','最近添加']]) sort.createEl('option',{value,text:label});
      const list=el.createDiv({cls:'wrp-shelf-list',attr:{role:'list'}});
      const draw=()=>{
        list.empty();const query=search.value.trim().toLocaleLowerCase();
        let books=this.vaultPicker?p.app.vault.getFiles().filter(file=>supported.test(file.path)).map(file=>({file,title:file.basename,author:'',format:file.extension.toUpperCase(),path:file.path})):p.settings.localBooks.slice();
        books=books.filter(book=>(book.title+' '+book.author).toLocaleLowerCase().includes(query));
        books.sort((a,b)=>sort.value==='title'?a.title.localeCompare(b.title,'zh-CN'):sort.value==='added'?(b.addedAt||0)-(a.addedAt||0):(b.lastOpened||0)-(a.lastOpened||0)||a.title.localeCompare(b.title,'zh-CN'));
        if(!books.length) list.createEl('p',{cls:'wrp-shelf-empty',text:query?'没有匹配的图书':this.vaultPicker?'仓库中没有 EPUB 或 TXT':'书架还没有图书。先添加本地文件。'});
        for(const book of books) {
          const row=list.createDiv({cls:'wrp-shelf-book',attr:{role:'listitem'}}), info=row.createDiv({cls:'wrp-shelf-book-info'});
          info.createEl('strong',{text:book.title});
          info.createEl('span',{text:[book.format,book.author,book.file?book.path:`已读 ${Math.round(book.progress?.percent||0)}%`].filter(Boolean).join(' · ')});
          const actions=row.createDiv({cls:'wrp-shelf-book-actions'});
          const open=actions.createEl('button',{text:book.file?'添加并阅读':'继续阅读',attr:{type:'button'}});
          open.addEventListener('click',async()=>{
            open.disabled=true;
            try {
              let entry=book;
              if(book.file) {const adapter=p.app.vault.adapter;const full=typeof adapter.getFullPath==='function'?adapter.getFullPath(book.file.path):require('path').join(adapter.getBasePath(),book.file.path);entry=(await p.addLocalPaths([full]))[0];}
              if(entry && await p.openLocalBook(entry.id)) this.close();
            } finally {if(open.isConnected)open.disabled=false;}
          });
          if(!book.file) {const remove=actions.createEl('button',{text:'移出',attr:{type:'button','aria-label':'从书架移出 '+book.title}});remove.addEventListener('click',()=>{p.removeLocalBook(book.id);draw();});}
        }
      };
      search.addEventListener('input',draw);sort.addEventListener('change',draw);draw();
    }
    onClose() {this.plugin.localShelfModal=null;this.contentEl.empty();}
  }
  class LocalBookmarks extends (Modal || class {}) {
    constructor(plugin) {super(plugin.app);this.plugin=plugin;this.entry=plugin.localEntry;}
    onOpen() {this.modalEl?.addClass('wrp-local-tools-modal');this.render();}
    render() {
      const p=this.plugin, entry=this.entry, el=this.contentEl;
      if(p.localEntry!==entry||!p.canUseLocalTools()){this.close();return;}
      el.empty();el.addClass('wrp-local-tools');el.createEl('h2',{text:'本书书签'});el.createEl('p',{cls:'wrp-local-tools-book',text:entry.title});
      const controls=el.createDiv({cls:'wrp-local-tools-controls'}),add=controls.createEl('button',{text:'添加当前位置',attr:{type:'button'}});
      add.addEventListener('click',()=>{p.addLocalBookmark();this.render();});
      const list=el.createDiv({cls:'wrp-local-tools-list',attr:{role:'list','aria-label':'本书书签'}}),bookmarks=bookmarksOf(entry.bookmarks);
      if(!bookmarks.length)list.createEl('p',{cls:'wrp-local-tool-empty',text:'还没有书签。添加当前位置后，可随时回来。'});
      for(const bookmark of bookmarks.slice().reverse()) {
        const row=list.createDiv({cls:'wrp-local-tool-row',attr:{role:'listitem'}}),jump=row.createEl('button',{cls:'wrp-local-tool-jump',attr:{type:'button','aria-label':'跳转到书签：'+bookmark.name}});
        jump.createSpan({cls:'wrp-local-tool-meta',text:bookmark.name||'第 '+(bookmark.chapter+1)+' 章'});jump.createSpan({cls:'wrp-local-tool-excerpt',text:bookmark.excerpt||'已读 '+Math.round(bookmark.percent)+'%'});
        jump.addEventListener('click',async()=>{jump.disabled=true;try{if(p.localEntry===entry&&await p.jumpToLocalPosition(bookmark))this.close();}finally{if(jump.isConnected)jump.disabled=false;}});
        const remove=row.createEl('button',{text:'移除',attr:{type:'button','aria-label':'移除书签：'+bookmark.name}});remove.addEventListener('click',()=>{p.removeLocalBookmark(entry.id,bookmark.id);this.render();});
      }
    }
    onClose(){if(this.plugin.localToolsModal===this){this.plugin.cancelLocalToolNavigation();this.plugin.localToolsModal=null;}this.contentEl.empty();}
  }
  class LocalSearch extends (Modal || class {}) {
    constructor(plugin) {super(plugin.app);this.plugin=plugin;this.entry=plugin.localEntry;this.book=plugin.localBook;this.running=false;this.results=[];}
    onOpen() {
      const p=this.plugin,el=this.contentEl;this.modalEl?.addClass('wrp-local-tools-modal');el.empty();el.addClass('wrp-local-tools');
      el.createEl('h2',{text:'搜索本书'});el.createEl('p',{cls:'wrp-local-tools-book',text:this.entry.title});
      const form=el.createEl('form',{cls:'wrp-local-tools-controls'});
      this.input=form.createEl('input',{type:'search',attr:{placeholder:'输入正文中的文字','aria-label':'搜索本书正文',maxlength:'256',autocomplete:'off'}});
      const submit=form.createEl('button',{text:'搜索',attr:{type:'submit'}});submit.addClass('mod-cta');
      this.cancelButton=form.createEl('button',{text:'停止',attr:{type:'button'}});this.cancelButton.hidden=true;
      this.status=el.createEl('p',{cls:'wrp-local-tools-status',text:'逐章搜索正文，最多显示 200 条结果。',attr:{role:'status','aria-live':'polite'}});
      this.list=el.createDiv({cls:'wrp-local-tools-list',attr:{role:'list','aria-label':'正文搜索结果'}});
      this.search=createLocalBookSearch({getBook:()=>p.localBook,isCurrent:()=>p.canUseLocalTools()&&p.localEntry===this.entry&&this.contentEl.isConnected,
        extractParagraphs:(payload,index)=>p.localReader.getSearchParagraphs(payload,index),
        onResults:results=>{this.results=results;this.renderResults();},onProgress:value=>{
          const end=value.done?(value.truncated?'已显示前 200 条结果。':'搜索完成。'):('已搜索 '+value.processed+'/'+value.total+' 章，');
          this.status.setText(end+'找到 '+value.count+' 条'+(value.failedChapters?'；'+value.failedChapters+' 章未能读取':'')+(value.done?'':'。'));
        }});
      form.addEventListener('submit',event=>{event.preventDefault();void this.runSearch();});
      this.cancelButton.addEventListener('click',()=>{this.search.cancel();this.running=false;this.cancelButton.hidden=true;this.status.setText('已停止，保留已找到的 '+this.results.length+' 条结果。');});
      this.input.focus();
    }
    async runSearch() {
      const query=this.input.value.replace(/\s+/g,' ').trim();this.plugin.cancelLocalToolNavigation();this.search.cancel();this.results=[];this.list.empty();
      if(!query){this.running=false;this.cancelButton.hidden=true;this.status.setText('请输入要查找的正文文字。');return;}
      const revision=(this.queryRevision||0)+1;this.queryRevision=revision;this.query=query;this.running=true;this.cancelButton.hidden=false;
      try {const result=await this.search.search(query);if(this.queryRevision!==revision||!this.contentEl.isConnected||result.canceled)return;this.running=false;this.cancelButton.hidden=true;if(!result.count)this.list.createEl('p',{cls:'wrp-local-tool-empty',text:result.failedChapters?'已读取的章节中没有匹配文字。':'本书正文中没有匹配文字。'});}
      catch(error){if(this.contentEl.isConnected&&this.queryRevision===revision){this.running=false;this.cancelButton.hidden=true;this.status.setText('搜索失败：'+error.message);}}
    }
    renderResults() {
      this.list.empty();const p=this.plugin;
      for(const result of this.results) {
        const row=this.list.createDiv({cls:'wrp-local-tool-row',attr:{role:'listitem'}}),jump=row.createEl('button',{cls:'wrp-local-tool-jump',attr:{type:'button'}});
        jump.createSpan({cls:'wrp-local-tool-meta',text:this.book.chapters[result.chapter]?.title||'第 '+(result.chapter+1)+' 章'});
        const excerpt=jump.createSpan({cls:'wrp-local-tool-excerpt'});excerpt.appendText(result.before);excerpt.createEl('mark',{text:result.match});excerpt.appendText(result.after);
        jump.addEventListener('click',async()=>{jump.disabled=true;try{if(p.localEntry===this.entry&&p.localBook===this.book&&await p.jumpToLocalPosition({chapter:result.chapter,paragraph:result.paragraph,offset:0},{highlight:this.query,matchStart:result.matchStart,matchLength:result.matchLength}))this.close();}finally{if(jump.isConnected)jump.disabled=false;}});
      }
    }
    onClose(){this.queryRevision=(this.queryRevision||0)+1;this.search?.destroy();this.results=[];if(this.plugin.localToolsModal===this){this.plugin.cancelLocalToolNavigation();this.plugin.localToolsModal=null;}this.contentEl.empty();}
  }
  const original={};
  const wrap=(name,handler)=>{original[name]=Pocket.prototype[name];Pocket.prototype[name]=function(...args){return handler.call(this,original[name],...args);};};
  Pocket.prototype.isLocalSource=function(){return this.settings?.readingSource==='local';};
  Pocket.prototype.initLocalBooks=function(){normalizeLibrary(this.settings);this.localStore=createLocalBookStore();this.localOpenRevision=0;this.localClosedBooks=new WeakSet();};
  Pocket.prototype.ensureLocalSurface=function(){
    if(this.localReader||!this.readingSurface||!this.isLocalSource()||this.unloaded)return;
    let reader;
    reader=createLocalReaderSurface({host:this.readingSurface,document:this.readingSurface.ownerDocument,onResize:()=>{if(this.localReader===reader&&this.isLocalSource())this.applyLocalAppearance();},onProgress:value=>{if(this.localReader===reader)this.saveLocalProgress(value);},onChapter:()=>{if(this.localReader===reader)this.updateLocalHeader();},onError:message=>{if(this.localReader===reader)new Notice(message);}});
    this.localReader=reader;
    const keydown=event=>{
      if(this.localReader!==reader||!this.isLocalSource())return;
      const input={key:event.key,control:event.ctrlKey,meta:event.metaKey,alt:event.altKey,shift:event.shiftKey,isAutoRepeat:event.repeat};
      if(event.key==='Escape'&&!reader.root.querySelector('.wrp-local-catalog')){event.preventDefault();event.stopPropagation();this.hide();return;}
      if(this.commandHotkeys('toggle').some(key=>dependencies.matchesHotkey(input,key))) {event.preventDefault();event.stopPropagation();if(!event.repeat)void this.toggle();return;}
      this.handleReaderNavigationHotkey?.(event,input);
    };
    reader.root.addEventListener('keydown',keydown,{capture:true});
    this.localReaderCleanup=()=>reader.root.removeEventListener('keydown',keydown,{capture:true});
    this.updateLocalSourceVisibility();
  };
  Pocket.prototype.closeLocalBook=function(book){
    if(!book||this.localClosedBooks.has(book))return Promise.resolve();
    this.localClosedBooks.add(book);return Promise.resolve().then(()=>book.close()).catch(()=>{});
  };
  Pocket.prototype.releaseLocalSource=function(){
    this.closeLocalTools();this.captureLocalProgress();this.localOpenRevision++;this.localOpening=false;
    const reader=this.localReader,books=[this.localBook,this.localPendingPreviousBook];
    this.localReader=null;this.localBook=null;this.localEntry=null;this.localPendingPreviousBook=null;
    this.localReaderCleanup?.();this.localReaderCleanup=null;reader?.destroy();
    this.nativeFontReady=false;
    for(const book of books)void this.closeLocalBook(book);
  };
  Pocket.prototype.updateLocalSourceVisibility=function(){this.readingSurface?.setAttribute('data-wrp-source',this.isLocalSource()?'local':'weread');if(this.localToolsButton)this.localToolsButton.hidden=!this.isLocalSource();};
  Pocket.prototype.initializeLocalLibrary=function(){
    if(this.localLibraryInitialization)return this.localLibraryInitialization;
    this.localLibraryInitialization=(async()=>{
      const context=await libraryContext(this);this.localLibraryContext=context;
      let migrated=0,unavailable=0;
      for(const entry of this.settings.localBooks.slice()) {
        try {
          if(inside(context.folder,nodePath.resolve(entry.path))) {await managedPath(this,entry.path,context);continue;}
          const managed=await managedPath(this,entry.path,context);entry.path=managed.path;entry.sourcePath=managed.sourcePath;migrated++;
        } catch {unavailable++;}
      }
      const discovered=await scanLibrary(this,context);
      if(migrated||discovered)this.persist();
      if(!this.localLibraryEventsRegistered&&typeof this.registerEvent==='function'&&typeof this.app.workspace?.on==='function') {
        this.localLibraryEventsRegistered=true;
        this.registerEvent(this.app.workspace.on('file-open',file=>{if(file&&isManagedRelative(file.path))void this.openManagedLocalFile(file,this.app.workspace.activeLeaf).catch(error=>new Notice('打开本地图书失败：'+error.message));}));
        const workspaceDocument=this.app.workspace.containerEl?.ownerDocument;
        if(workspaceDocument&&typeof this.registerDomEvent==='function')this.registerDomEvent(workspaceDocument,'click',event=>{
          const item=event.target?.closest?.('.nav-file-title, .nav-file');
          const relative=item?.getAttribute('data-path')||item?.closest('.nav-file')?.getAttribute('data-path');
          if(!isManagedRelative(relative))return;
          const file=this.app.vault.getAbstractFileByPath(relative);
          if(!file||!supported.test(file.path))return;
          event.preventDefault();event.stopPropagation();
          void this.openManagedLocalFile(file).catch(error=>new Notice('打开本地图书失败：'+error.message));
        },{capture:true});
        if(typeof this.app.vault.on==='function') {
          this.registerEvent(this.app.vault.on('create',file=>{if(file&&isManagedRelative(file.path))void this.refreshLocalLibrary().catch(()=>{});}));
          this.registerEvent(this.app.vault.on('delete',file=>{
            if(!isManagedRelative(file.path))return;
            const absolute=nodePath.resolve(context.base,...file.path.split('/')), entry=this.settings.localBooks.find(book=>canonical(book.path)===canonical(absolute));
            if(entry)this.removeLocalBook(entry.id);
            this.settings.localExcludedPaths=this.settings.localExcludedPaths.filter(value=>value!==file.path);this.persist();
          }));
          this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{
            if(!file||!isLibraryRelative(oldPath))return;
            const oldAbsolute=nodePath.resolve(context.base,...oldPath.split('/')),newAbsolute=nodePath.resolve(context.base,...file.path.split('/'));
            const moved=path=>nodePath.join(newAbsolute,nodePath.relative(oldAbsolute,path));
            const previousExcluded=this.settings.localExcludedPaths.slice();
            for(const entry of this.settings.localBooks.slice()) {
              if(!inside(oldAbsolute,nodePath.resolve(entry.path)))continue;
              const next=moved(entry.path);
              if(inside(context.folder,next)&&isManagedRelative(vaultPath(context,next)))entry.path=next;
              else this.removeLocalBook(entry.id);
            }
            this.settings.localExcludedPaths=previousExcluded.map(relative=>{
              const absolute=nodePath.resolve(context.base,...relative.split('/'));
              if(!inside(oldAbsolute,absolute))return relative;
              const next=vaultPath(context,moved(absolute));return isManagedRelative(next)?next:null;
            }).filter(Boolean);
            this.persist();
          }));
        }
      }
      return {folder:libraryFolder,migrated,discovered,unavailable};
    })().catch(error=>{this.localLibraryInitialization=null;throw error;});
    return this.localLibraryInitialization;
  };
  Pocket.prototype.refreshLocalLibrary=async function(){await this.initializeLocalLibrary();const added=await scanLibrary(this,this.localLibraryContext);if(added)this.persist();return added;};
  Pocket.prototype.revealLocalLibraryFolder=async function(){
    try {
      await this.initializeLocalLibrary();
      const leaves=this.app.workspace.getLeavesOfType('file-explorer'), leaf=leaves[0];
      const internal=this.app.internalPlugins?.getPluginById?.('file-explorer')?.instance;
      const explorer=typeof leaf?.view?.revealInFolder==='function'?leaf.view:internal;
      const folder=this.app.vault.getAbstractFileByPath(libraryFolder);
      if(leaf)await this.app.workspace.revealLeaf(leaf);
      if(typeof explorer?.revealInFolder==='function'&&folder){await explorer.revealInFolder(folder);return true;}
      const remote=require('@electron/remote');await remote.shell.openPath(this.localLibraryContext.folder);return true;
    } catch(error){new Notice('打开图书文件夹失败：'+error.message);return false;}
  };
  Pocket.prototype.openManagedLocalFile=async function(file,leaf){
    if(!file||!isManagedRelative(file.path))return false;
    const revision=(this.localFileOpenRevision||0)+1;this.localFileOpenRevision=revision;
    await this.initializeLocalLibrary();
    if(this.unloaded||revision!==this.localFileOpenRevision)return false;
    const absolute=nodePath.resolve(this.localLibraryContext.base,...file.path.split('/'));
    await managedPath(this,absolute,this.localLibraryContext);
    const location=this.visible?this.readingLocation?.():(this.lastReadingLocation||this.readingLocation?.());
    const entries=await this.addLocalPaths([absolute]);
    if(!entries.length||this.unloaded||revision!==this.localFileOpenRevision)return false;
    if(!await this.openLocalBook(entries[0].id)||this.unloaded||revision!==this.localFileOpenRevision||!this.isLocalSource())return false;
    if(location==='sidebar'||location==='tab')await this.openReader(location);
    if(leaf&&leaf!==this.readerLeaf&&leaf!==this.dockLeaf&&leaf.view?.file?.path===file.path&&typeof leaf.detach==='function')await leaf.detach();
    return true;
  };
  Pocket.prototype.showBookshelf=function(){if(this.localShelfModal)this.localShelfModal.close();this.localShelfModal=new LocalShelf(this);this.localShelfModal.open();void this.refreshLocalLibrary().then(()=>{if(this.localShelfModal?.contentEl.isConnected)this.localShelfModal.render();}).catch(error=>new Notice('准备本地书架失败：'+error.message));};
  Pocket.prototype.importLocalFiles=async function(){
    try {
      const remote=require('@electron/remote');
      const result=await remote.dialog.showOpenDialog(remote.getCurrentWindow(),{title:'添加本地图书',properties:['openFile','multiSelections'],filters:[{name:'本地图书 (EPUB / TXT)',extensions:['epub','txt']}]});
      if(result.canceled)return [];
      const entries=await this.addLocalPaths(result.filePaths);
      if(entries.length)new Notice(`已添加 ${entries.length} 本图书`);
      return entries;
    } catch(error){new Notice('添加图书失败：'+error.message);return [];}
  };
  Pocket.prototype.addLocalPaths=async function(paths){
    const added=[];await this.initializeLocalLibrary();
    const run=async()=>{
      this.localLibraryImportActive=true;
      try {for(const path of paths) {
        let book,managed;
        try {
          if(typeof path!=='string'||!supported.test(path))throw new Error('目前支持 EPUB 和 TXT');
          const existing=this.settings.localBooks.find(entry=>canonical(entry.path)===canonical(path)||(entry.sourcePath&&canonical(entry.sourcePath)===canonical(path)));
          if(existing){excludePath(this,this.localLibraryContext,existing.path,false);added.push(existing);continue;}
          book=await this.localStore.open(path);
          managed=await managedPath(this,path,this.localLibraryContext);
          const entry={...placeholder(managed.path),sourcePath:managed.sourcePath,title:book.title,author:book.author,format:String(book.format).toUpperCase()};
          excludePath(this,this.localLibraryContext,managed.path,false);
          this.settings.localBooks.push(entry);added.push(entry);this.persist();
        } catch(error){new Notice(nodePath.basename(String(path))+'：'+error.message);}
        finally {await book?.close();}
      }
      return added;
      } finally {this.localLibraryImportActive=false;}
    };
    const task=(this.localLibraryImportTask||Promise.resolve()).catch(()=>{}).then(run);this.localLibraryImportTask=task;return task;
  };
  Pocket.prototype.saveLocalProgress=function(value){
    if(!this.isLocalSource()||!this.localEntry||this.localOpening)return;
    this.localEntry.progress=progressOf(value);this.persist();
  };
  Pocket.prototype.captureLocalProgress=function(){if(this.isLocalSource()&&this.ready&&this.localEntry&&this.settings.localBooks.includes(this.localEntry)&&this.localReader?.book===this.localBook){this.localEntry.progress=progressOf(this.localReader.captureProgress());this.persist();}};
  Pocket.prototype.openLocalBook=async function(id,force=false){
    const entry=this.settings.localBooks.find(book=>book.id===id);
    if(!entry){new Notice('请先从本地书架选择一本书');return false;}
    if(this.localEntry!==entry||force)this.closeLocalTools();
    const token=++this.localOpenRevision;
    const startupSource=!this.panel?this.settings.readingSource:null;
    if(!this.panel){this.settings.readingSource='local';this.build();}
    this.captureLocalProgress();
    if(this.localEntry?.id===id&&this.localReader?.book===this.localBook&&this.ready&&!force) {
      this.localOpening=false;this.settings.readingSource='local';this.updateLocalSourceVisibility();this.show();await this.applyAppearance();this.persist();return true;
    }
    this.localOpening=true;let book;
    try {
      book=await this.localStore.open(entry.path);
      const commit=async()=>{
        if(this.unloaded||token!==this.localOpenRevision||!this.settings.localBooks.includes(entry)){await this.closeLocalBook(book);return false;}
        this.captureLocalProgress();
        const previous={book:this.localBook,entry:this.localEntry,source:startupSource||this.settings.readingSource,ready:this.ready};
        this.localPendingPreviousBook=previous.book;
        this.appearanceRevision=(this.appearanceRevision||0)+1;this.appearanceGeneration=(this.appearanceGeneration||0)+1;
        this.settings.readingSource='local';this.ready=false;this.ensureLocalSurface();
        const reader=this.localReader;
        this.localEntry=entry;this.localBook=book;
        this.updateLocalSourceVisibility();this.setAppearancePending(false);this.show();
        const rollback=async()=>{
          // A newer source choice owns its own reader. Never resurrect a
          // removed surface or a book after returning to WeRead/unloading.
          if(this.unloaded||this.localReader!==reader||this.localBook!==book){await this.closeLocalBook(previous.book);return;}
          const retained=previous.entry&&this.settings.localBooks.includes(previous.entry);
          this.localBook=retained?previous.book:null;this.localEntry=retained?previous.entry:null;
          this.localPendingPreviousBook=null;this.settings.readingSource=previous.source;this.ready=previous.ready;
          if(this.localBook)await reader.setBook(this.localBook,this.localEntry.progress);
          else {this.localReader=null;this.localReaderCleanup?.();this.localReaderCleanup=null;reader.destroy();await this.closeLocalBook(previous.book);}
          this.updateLocalSourceVisibility();
          if(this.isLocalSource()){this.ensureLocalSurface();this.applyLocalAppearance();}
          else {this.ensureWeReadWebview();if(this.ready)void this.applyAppearance();}
        };
        try {
          this.applyLocalAppearance();
          if(await reader.setBook(book,entry.progress)===false)throw new Error('无法读取当前章节，请检查图书文件。');
          if(this.unloaded||token!==this.localOpenRevision||!this.settings.localBooks.includes(entry)||this.localReader!==reader){await rollback();await this.closeLocalBook(book);return false;}
          // Keep the previous official page only until the first chapter has
          // succeeded, so a malformed local book can roll back immediately.
          this.releaseWeReadWebview();
          await this.closeLocalBook(previous.book===book?null:previous.book);this.localPendingPreviousBook=null;
          if(this.unloaded||token!==this.localOpenRevision||this.localReader!==reader||this.localBook!==book)return false;
          this.localOpening=false;entry.title=book.title;entry.author=book.author;entry.lastOpened=Date.now();this.settings.localLastBook=id;
          this.ready=true;await this.applyAppearance();if(this.unloaded||token!==this.localOpenRevision||this.localReader!==reader)return false;this.updateLocalHeader();this.persist();return true;
        } catch(error) {try{await rollback();}finally{await this.closeLocalBook(book);}if(token===this.localOpenRevision&&!this.unloaded)throw error;return false;}
      };
      const task=(this.localCommitTask||Promise.resolve()).catch(()=>false).then(commit);
      this.localCommitTask=task;return await task;
    } catch(error){
      if(token===this.localOpenRevision&&!this.unloaded){
        if(startupSource&&!this.localBook){if(startupSource!=='local')this.releaseLocalSource();this.settings.readingSource=startupSource;this.updateLocalSourceVisibility();if(!this.isLocalSource())this.ensureWeReadWebview();}
        new Notice('本地图书无法打开：'+error.message);
      }
      return false;
    } finally {if(token===this.localOpenRevision)this.localOpening=false;}
  };
  Pocket.prototype.removeLocalBook=function(id){
    this.localOpenRevision++;this.localOpening=false;
    if(this.localEntry?.id===id){this.releaseLocalSource();this.ready=false;this.ensureLocalSurface();}
    const removed=this.settings.localBooks.find(book=>book.id===id);if(removed&&this.localLibraryContext)excludePath(this,this.localLibraryContext,removed.path,true);
    this.settings.localBooks=this.settings.localBooks.filter(book=>book.id!==id);if(this.settings.localLastBook===id)this.settings.localLastBook='';this.persist();this.updateLocalHeader();
  };
  Pocket.prototype.useWeReadSource=function(){
    const changed=this.isLocalSource();
    this.localFileOpenRevision=(this.localFileOpenRevision||0)+1;
    this.releaseLocalSource();
    this.settings.readingSource='weread';
    if(!this.panel)this.build();
    if(changed){this.ready=!!this.webview&&!!this.wereadReady;this.nativeFontReady=false;this.styledNavigationRevision=-1;this.appearanceRevision=(this.appearanceRevision||0)+1;}
    this.updateLocalSourceVisibility();this.ensureWeReadWebview();this.show();
    if(this.ready){this.bindGuestKeys();void this.applyAppearance();}
    this.updateLocalHeader();this.persist();
  };
  Pocket.prototype.isLocalPublisherTypography=function(){return this.isLocalSource() && !this.isLiteratureEnabled() && this.settings.localTypography!=='custom';};
  Pocket.prototype.setLocalTypography=function(mode){
    if(!['publisher','custom'].includes(mode))return false;
    this.settings.localTypography=mode;this.persist();
    if(this.isLocalSource())this.applyLocalAppearance();this.updateLayoutControls();return true;
  };
  Pocket.prototype.applyLocalAppearance=function(){
    this.activateLayoutProfile();this.updateHostTheme();this.updateLocalSourceVisibility();
    const profile=this.layoutProfile();this.localReader?.applyAppearance({...profile,localTypography:this.settings.localTypography,fontSize:profile.fontSizePx,fontFamily:this.literatureConfig().fontFamily,palette:this.readingPalette(),literature:{...this.literatureConfig(),title:this.settings.literatureTitle},readingFlow:this.isLiteratureEnabled()?'scroll':this.settings.readingFlow,continuousChapters:this.settings.continuousChapters!==false});
    this.nativeFontSize=profile.fontSizePx;this.nativeFontReady=!!this.localReader?.book;this.styledNavigationRevision=this.navigationRevision;this.setAppearancePending(false);this.updateFontButtons();this.updateLocalHeader();
  };
  Pocket.prototype.updateLocalHeader=function(){
    if(!this.isLocalSource())return;
    const title=this.isLiteratureEnabled()?(this.settings.literatureTitle.trim()||'Literature notes'):(this.localBook?.title||'本地书架');
    if(this.message)this.message.setText(title);
    if(this.readerView?.titleEl){this.readerView.headerData={title,addLabel:'',addDisabled:true};this.readerView.titleEl.setText(title);this.readerView.titleEl.title=title;this.readerView.addShelfButton.hidden=true;}
  };
  Pocket.prototype.canUseLocalTools=function(){return !this.unloaded&&this.isLocalSource()&&this.ready&&!this.localOpening&&!!this.localEntry&&!!this.localBook&&!!this.localReader&&this.localReader.book===this.localBook;};
  Pocket.prototype.cancelLocalToolNavigation=function(){this.localToolNavigationRevision=(this.localToolNavigationRevision||0)+1;};
  Pocket.prototype.closeLocalTools=function(){this.cancelLocalToolNavigation();this.localToolsModal?.close();this.localToolsModal=null;};
  Pocket.prototype.addLocalBookmark=function(){
    if(!this.canUseLocalTools()){new Notice('请先打开一本本地图书');return false;}
    const entry=this.localEntry,position=progressOf(this.localReader.captureProgress()),bookmarks=bookmarksOf(entry.bookmarks);
    const existing=bookmarks.find(value=>value.chapter===position.chapter&&value.paragraph===position.paragraph&&Math.abs(value.offset-position.offset)<.02);
    if(existing){new Notice('这个位置已有书签');return existing;}
    if(bookmarks.length>=bookmarkLimit){new Notice('本书已有 500 个书签，请先移除不需要的书签');return false;}
    const bookmark={id:require('crypto').randomBytes(12).toString('hex'),...position,name:String(this.localBook.chapters[position.chapter]?.title||'第 '+(position.chapter+1)+' 章').slice(0,120),
      excerpt:String(this.localReader.getParagraphText?.(position.chapter,position.paragraph,160)||'').slice(0,160),createdAt:Date.now()};
    entry.bookmarks=[...bookmarks,bookmark];this.persist();new Notice('已添加当前位置书签');return bookmark;
  };
  Pocket.prototype.removeLocalBookmark=function(bookId,bookmarkId){const entry=this.settings.localBooks.find(book=>book.id===bookId);if(!entry)return false;const before=bookmarksOf(entry.bookmarks);entry.bookmarks=before.filter(value=>value.id!==bookmarkId);if(entry.bookmarks.length===before.length)return false;this.persist();return true;};
  Pocket.prototype.jumpToLocalPosition=async function(position,options){
    if(!this.canUseLocalTools()||typeof this.localReader.navigateToProgress!=='function')return false;
    const reader=this.localReader,entry=this.localEntry;this.cancelLocalToolNavigation();const revision=this.localToolNavigationRevision;const moved=await reader.navigateToProgress(position,options);
    if(moved===false||revision!==this.localToolNavigationRevision||this.localReader!==reader||this.localEntry!==entry||!this.isLocalSource())return false;
    this.captureLocalProgress();this.show();return true;
  };
  Pocket.prototype.showLocalBookmarks=function(){if(!this.canUseLocalTools()){new Notice('请先打开一本本地图书');return false;}this.closeLocalTools();this.localToolsModal=new LocalBookmarks(this);this.localToolsModal.open();return true;};
  Pocket.prototype.showLocalSearch=function(){if(!this.canUseLocalTools()||typeof createLocalBookSearch!=='function'||typeof this.localReader.getSearchParagraphs!=='function'){new Notice('请先打开一本本地图书');return false;}this.closeLocalTools();this.localToolsModal=new LocalSearch(this);this.localToolsModal.open();return true;};
  Pocket.prototype.renderLocalBookSettings=function(el){
    const p=this;
    new Setting(el).setName('本地书架').setDesc('导入 EPUB、TXT 后，复制到仓库根目录的 WeRead Pocket 文件夹；原文件保留。正文按需读取，可选原书或各窗口自定义排版。移出书架只移除记录，保留图书文件。').addButton(b=>b.setButtonText('打开书架').onClick(()=>p.showBookshelf())).addButton(b=>b.setButtonText('添加图书').onClick(()=>p.importLocalFiles())).addButton(b=>b.setButtonText('打开书籍文件夹').onClick(()=>p.revealLocalLibraryFolder()));
    let typography;new Setting(el).setName('本地正文排版').setDesc('默认保留 EPUB 的原书排版，TXT 保留原文缩进与换行。选择自定义后使用各窗口的字号、行距、段距、留白和两字首行缩进。文献卡片使用自己的排版。').addDropdown(d=>{typography=d;d.addOptions({publisher:'原书 / 原文排版',custom:'自定义排版'}).setValue(p.settings.localTypography).onChange(value=>p.setLocalTypography(value));}).addButton(b=>b.setButtonText('恢复默认').onClick(()=>{typography.setValue('publisher');p.setLocalTypography('publisher');}));
    new Setting(el).setName('跨章节连续阅读').setDesc('本地图书在连续上下滚动时自动接上下一章，并隐藏正文的上一章、下一章按钮。关闭后按章节阅读；目录仍可随时跳转。').addToggle(t=>t.setValue(p.settings.continuousChapters!==false).onChange(value=>{p.settings.continuousChapters=value;p.persist();void p.applyAppearance();}));
  };
  wrap('mountWebview',function(base,...args){if(this.isLocalSource()&&this.ready)this.localReader?.preserveProgress?.();return base.apply(this,args);});
  wrap('addLayoutControls',function(base,...args){
    const entry=base.apply(this,args),owner=args[3]||this;
    const row=entry.panel.createDiv({cls:'wrp-layout-row wrp-local-typography-row'});entry.panel.prepend(row);
    row.createSpan({cls:'wrp-layout-label',text:'正文排版'});
    const select=row.createEl('select',{attr:{'aria-label':'本地正文排版'}});
    select.createEl('option',{value:'publisher',text:'原书 / 原文排版'});select.createEl('option',{value:'custom',text:'自定义排版'});
    owner.registerDomEvent(select,'change',()=>this.setLocalTypography(select.value));entry.localTypography={row,select};this.updateLayoutControls();return entry;
  });
  wrap('updateLayoutControls',function(base,...args){
    const result=base.apply(this,args),publisher=this.isLocalPublisherTypography();
    for(const entry of this.layoutControls||[]){if(entry.localTypography){entry.localTypography.row.hidden=!this.isLocalSource()||this.isLiteratureEnabled();entry.localTypography.select.value=this.settings.localTypography;}
      if(publisher)for(const {value,minus,plus,reset} of entry.rows){value.setText('原书');value.title='切换到自定义排版后可调整';minus.disabled=true;plus.disabled=true;reset.disabled=true;}
    }return result;
  });
  wrap('updateFontButtons',function(base,...args){const result=base.apply(this,args);if(this.isLocalPublisherTypography())for(const {button} of this.fontButtons||[]){button.disabled=true;button.title='在排版面板选择自定义排版后调整字号';}return result;});
  wrap('build',function(base,...args){const result=base.apply(this,args);if(this.isLocalSource()){this.ensureLocalSurface();}if(this.isLocalSource()){this.ready=false;this.setAppearancePending(false);if(this.settings.localLastBook)void Promise.resolve().then(()=>{if(this.isLocalSource()&&!this.localOpening&&!this.localBook&&!this.unloaded)void this.openLocalBook(this.settings.localLastBook);});else this.updateLocalHeader();}return result;});
  wrap('applyAppearance',function(base,...args){if(!this.isLocalSource())return base.apply(this,args);this.appearanceRevision=(this.appearanceRevision||0)+1;this.applyLocalAppearance();return Promise.resolve();});
  wrap('refreshReaderLayout',function(base,...args){if(!this.isLocalSource())return base.apply(this,args);this.applyLocalAppearance();return Promise.resolve();});
  wrap('syncNativeReaderPadding',function(base,...args){return this.isLocalSource()?Promise.resolve(true):base.apply(this,args);});
  wrap('refreshFontControls',function(base,...args){if(!this.isLocalSource())return base.apply(this,args);const profile=this.layoutProfile();this.nativeFontSize=profile.fontSizePx;this.nativeFontReady=!!this.localReader?.book;this.updateFontButtons();return Promise.resolve({size:profile.fontSizePx,level:dependencies.FONT_SIZES.indexOf(profile.fontSizePx),lineHeight:profile.lineHeight,paragraphSpacing:profile.paragraphSpacing,ready:this.nativeFontReady,preferenceKey:this.typographyPreferenceKey()});});
  wrap('changeTypography',function(base,value,relative,kind,key=this.layoutProfileKey(),card=!!this.isLiteratureEnabled()){
    if(!this.isLocalSource())return base.call(this,value,relative,kind,key,card);
    if(this.unloaded||key!==this.layoutProfileKey()||card!==!!this.isLiteratureEnabled())return Promise.resolve(false);
    const profile=this.layoutProfile(),field={font:'fontSizePx',line:'lineHeight',paragraph:'paragraphSpacing'}[kind];if(!field)return Promise.resolve(false);
    const old=profile[field],sizes=dependencies.FONT_SIZES;
    const target=kind==='font'?(relative?sizes[Math.max(0,Math.min(sizes.length-1,sizes.indexOf(old)+value))]:Number(value)):kind==='line'?Math.round(Math.max(1,Math.min(3,relative?old+value*.1:Number(value)))*10)/10:Math.max(0,Math.min(80,relative?old+value*2:Number(value)));
    if(!Number.isFinite(target)||(kind==='font'&&!sizes.includes(target)))return Promise.resolve(false);
    profile[field]=target;this.applyLocalAppearance();this.persist();return Promise.resolve(true);
  });
  wrap('changeReadingFlow',function(base,flow){if(!this.isLocalSource())return base.call(this,flow);if(!['scroll','paged'].includes(flow)||!this.localReader?.book)return Promise.resolve(false);if(flow==='paged'&&this.isLiteratureEnabled()){new Notice('请先关闭文献卡片外观，再使用分页阅读');return Promise.resolve(false);}this.settings.readingFlow=flow;this.persist();this.applyLocalAppearance();return Promise.resolve(true);});
  wrap('changeReaderScroll',function(base,direction){return this.isLocalSource()?Promise.resolve(this.localReader?.scrollByDirection(direction)||false):base.call(this,direction);});
  wrap('changeReaderChapter',function(base,direction){return this.isLocalSource()?Promise.resolve(this.localReader?.navigateChapter(direction)||false):base.call(this,direction);});
  wrap('turnPage',function(base,key){return this.isLocalSource()?this.localReader?.turn(key==='Left'?-1:1):base.call(this,key);});
  wrap('openCatalog',function(base,...args){return this.isLocalSource()?this.localReader?.openCatalog():base.apply(this,args);});
  wrap('reloadPage',function(base,...args){return this.isLocalSource()?(this.localEntry?this.openLocalBook(this.localEntry.id,true):this.showBookshelf()):base.apply(this,args);});
  wrap('refreshReaderHeader',function(base,...args){return this.isLocalSource()?(this.updateLocalHeader(),Promise.resolve(null)):base.apply(this,args);});
  wrap('navigatePage',function(base,url){if(this.isLocalSource())this.useWeReadSource();return base.call(this,url);});
  wrap('hide',function(base,...args){this.closeLocalTools();this.captureLocalProgress();return base.apply(this,args);});
  wrap('updateShortcutHints',function(base,...args){const result=base.apply(this,args);this.updateLocalHeader();return result;});
  wrap('onunload',function(base,...args){this.captureLocalProgress();if(this.localEntry&&!this.__wrpValidationPersist)void this.saveData(this.settings).catch(()=>{});this.localFileOpenRevision=(this.localFileOpenRevision||0)+1;this.releaseLocalSource();this.localShelfModal?.close();return base.apply(this,args);});
  wrap('onload',async function(base,...args){const result=typeof base==='function'?await base.apply(this,args):undefined;if(this.unloaded||typeof this.addCommand!=='function')return result;
    for(const [id,name,method] of [['add-local-bookmark','本地图书：添加当前位置书签','addLocalBookmark'],['show-local-bookmarks','本地图书：查看本书书签','showLocalBookmarks'],['search-local-book','本地图书：搜索本书正文','showLocalSearch']])this.addCommand({id,name,checkCallback:checking=>{const available=this.canUseLocalTools();if(available&&!checking)this[method]();return available;}});
    return result;});
  return {normalizeLibrary,progressOf,bookmarksOf,idFor,libraryFolder,isManagedRelative,inside,libraryContext,LocalBookmarks,LocalSearch};
})
