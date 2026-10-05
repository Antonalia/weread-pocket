const { Plugin, PluginSettingTab, Setting, Notice, Menu, Modal, setIcon, ItemView, Platform } = require('obsidian');
const ViewBase = ItemView || class {};

const HOME = 'https://weread.qq.com/web/shelf';
const READER_TOGGLE_NAME = '快速收起 / 恢复阅读器（所有模式）';
const READER_NAVIGATION_COMMANDS = {
  'scroll-up': {name:'向上滚动阅读正文',action:'scroll',direction:-1,key:'ArrowUp'},
  'scroll-down': {name:'向下滚动阅读正文',action:'scroll',direction:1,key:'ArrowDown'},
  'previous-chapter': {name:'阅读上一章',action:'chapter',direction:-1,key:'PageUp'},
  'next-chapter': {name:'阅读下一章',action:'chapter',direction:1,key:'PageDown'}
};
const COMMAND_HOTKEYS = {toggle:[{modifiers:['Mod','Alt'],key:'R'}],...Object.fromEntries(Object.entries(READER_NAVIGATION_COMMANDS).map(([id,{key}])=>[id,[{modifiers:['Mod','Alt'],key}]]))};
// Runs inside the current official reader only. Programmatic scrolling leaves
// keyboard focus in the Obsidian editor.
async function officialReaderNavigation(action,direction) {
  if(!['scroll','chapter'].includes(action)||![-1,1].includes(direction)) return {performed:false};
  const chapter=document.querySelector('.readerChapterContent');
  if(!chapter) return {performed:false};
  if(action==='scroll') {
    const notes=document.querySelector('.readerReviewDetailPanel_bg.wrp-notes-scroll-active');
    if(!notes&&document.querySelector('.wr_horizontalReader')) return {performed:false,paged:true};
    let target=notes||document.scrollingElement;
    for(let node=notes?null:chapter.parentElement;node&&node!==document.body;node=node.parentElement) {
      if(/auto|scroll/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+1) {target=node;break;}
    }
    if(!target||!target.clientHeight) return {performed:false};
    const paragraph=notes?(notes.querySelector('.readerReviewDetail_item > .content')||notes):(chapter.querySelector('.renderTargetContent p, .preRenderContent p, p')||chapter);
    const style=getComputedStyle(paragraph),font=parseFloat(style.fontSize)||16;
    const line=parseFloat(style.lineHeight)||font*1.5;
    const step=Math.min(Math.max(24,line*3),Math.max(24,target.clientHeight*.8));
    const before=target.scrollTop;
    target.scrollTop=Math.max(0,Math.min(target.scrollHeight-target.clientHeight,before+direction*step));
    return {performed:target.scrollTop!==before};
  }
  return {performed:false};
}
const LITERATURE_DEFAULTS = { enabled:false, title:'Literature notes', english:'The analysis examines how local observations contribute to a broader understanding of the system. Context and sequential evidence are considered together.\n\nA consistent interpretation requires comparing individual events with the surrounding conditions. The following notes record the details relevant to this comparison.', paragraphs:3 };
function matchesHotkey(input,hotkey) {
  const aliases={esc:'escape',return:'enter',' ':'space',arrowup:'up',arrowdown:'down',arrowleft:'left',arrowright:'right'};
  const normalize=key=>{const value=String(key||'').toLowerCase();return aliases[value]||value;};
  if(!hotkey?.key||normalize(input.key)!==normalize(hotkey.key)) return false;
  const modifiers=new Set(hotkey.modifiers||[]),mac=!!Platform?.isMacOS;
  const control=modifiers.has('Ctrl')||modifiers.has('Control')||(!mac&&modifiers.has('Mod'));
  const meta=modifiers.has('Meta')||modifiers.has('Cmd')||modifiers.has('Command')||(mac&&modifiers.has('Mod'));
  return !!input.control===control&&!!input.meta===meta&&!!input.alt===modifiers.has('Alt')&&!!input.shift===modifiers.has('Shift');
}
const DEFAULTS = { width: 380, height: 280, x: null, y: null, zoom: 0.9, compact: true, autoHide: false, dockPocket: false, dockHeight: 280, dockAutoCollapse: false, pocketToolbarPosition: 'top', dockToolbarPosition: 'bottom', pocketHideTrigger:'leave', dockHideTrigger:'leave', dockExpandTrigger:'hover', lastUrl: HOME, controlsPosition: 'right', contentPadding: 64, miniContentPadding: 16, lineHeight: 1.9, hideBottomBar: true, readingFlow: 'scroll', showPopularUnderlines: true, fontSizeLevel: 2, fontSizePx: null, catalogFontSize: 12, appearance: 'auto' };
const POCKET_TOOLBAR_POSITIONS = {top:'上面',bottom:'下面',left:'左面',right:'右面'};
const FONT_SIZES = [10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42];
const DEFAULT_FONT_SIZE = FONT_SIZES[DEFAULTS.fontSizeLevel + 3];
const LAYOUT_LABELS = { floating: '浮动小窗', dock: '侧栏底部小窗', sidebar: '右侧栏阅读', tab: '工作区标签页' };
function normalizedLiteratureLocations(settings) {
  return Object.fromEntries(Object.keys(LAYOUT_LABELS).map(key=>[
    key,typeof settings.literatureLocations?.[key]==='boolean' ? settings.literatureLocations[key] : !!settings.literatureDisguise
  ]));
}
function normalizedUnderlineProfiles(settings) {
  const legacy = settings.showPopularUnderlines !== false;
  return Object.fromEntries(['reading','card'].map(mode => [mode,
    Object.fromEntries(Object.keys(LAYOUT_LABELS).map(key => [key,
      typeof settings.underlineProfiles?.[mode]?.[key] === 'boolean' ? settings.underlineProfiles[mode][key] : legacy
    ]))
  ]));
}
function normalizedLayoutProfiles(settings) {
  const roundLine = value => Math.round(Math.max(1, Math.min(3, Number(value) || 1.9)) * 10) / 10;
  const legacyFont = FONT_SIZES.includes(Number(settings.fontSizePx)) ? Number(settings.fontSizePx) : FONT_SIZES[(Number(settings.fontSizeLevel) || 2) + 3] || DEFAULT_FONT_SIZE;
  return Object.fromEntries(Object.keys(LAYOUT_LABELS).map(key => {
    const saved = settings.layoutProfiles?.[key] || {}, pocket = key === 'floating' || key === 'dock';
    const font = Number(saved.fontSizePx ?? legacyFont), padding = Number(saved.contentPadding ?? settings[pocket ? 'miniContentPadding' : 'contentPadding']);
    return [key, { fontSizePx: FONT_SIZES.includes(font) ? font : legacyFont, lineHeight: roundLine(saved.lineHeight ?? settings.lineHeight), paragraphSpacing: Math.max(0, Math.min(80, Number(saved.paragraphSpacing ?? settings.paragraphSpacing) || 0)), contentPadding: Math.max(4, Math.min(320, padding || (pocket ? 16 : 64))) }];
  }));
}
function cardDefaults() {
  // Reference literature notes use compact 12px text. The body UI size is
  // larger and must not silently enlarge these cards; the family follows it.
  return {fontSizePx:12,lineHeight:1.3,paragraphSpacing:4,contentPadding:12};
}
function normalizedCardProfiles(settings) {
  const defaults=cardDefaults();
  return Object.fromEntries(Object.keys(LAYOUT_LABELS).map(key=>{
    const saved=settings.cardLayoutProfiles?.[key]||{}, font=Number(saved.fontSizePx);
    return [key,{fontSizePx:FONT_SIZES.includes(font)?font:defaults.fontSizePx,lineHeight:Math.round(Math.max(1,Math.min(3,Number(saved.lineHeight)||defaults.lineHeight))*10)/10,paragraphSpacing:Math.max(0,Math.min(80,Number(saved.paragraphSpacing??defaults.paragraphSpacing)||0)),contentPadding:Math.max(4,Math.min(320,Number(saved.contentPadding)||defaults.contentPadding))}];
  }));
}
const THEME_COLORS = {
  dark: { primary: '#1c1c1d', secondary: '#262628', border: '#414145', hover: '#ffffff12', field: '#303033', text: '#d0d3d8', muted: '#a4a7ae', faint: '#72757b' },
  light: { primary: '#ffffff', secondary: '#f6f7f9', border: '#dddfe5', hover: '#0000000a', field: '#ffffff', text: '#0d141e', muted: '#5d646e', faint: '#858c96' }
};
const THEME_VARIABLES = { primary: '--background-primary', secondary: '--background-secondary', border: '--background-modifier-border', hover: '--background-modifier-hover', field: '--background-modifier-form-field', text: '--text-normal', muted: '--text-muted', faint: '--text-faint' };
function readerThemeCss(palette) {
  return `
    :root { color-scheme: ${palette.theme}; --wrp-background-primary: ${palette.primary}; --wrp-background-secondary: ${palette.secondary}; --wrp-border: ${palette.border}; --wrp-text-normal: ${palette.text}; --wrp-text-muted: ${palette.muted}; --wrp-controls-background: ${palette.secondary}; }
    body.wr_page_reader, .wr_page_reader .app, .wr_page_reader .readerContent, .wr_page_reader .app_content,
    .wr_page_reader .wr_horizontalReader, .wr_page_reader .readerChapterContent, .wr_page_reader .readerCatalog { background-color: var(--wrp-background-primary) !important; }
    .wr_page_reader .readerTopBar, .wr_page_reader .readerBottomBar, .wr_page_reader .readerFooter_last_page,
    .wr_page_reader .readerCatalog_searchBar_inner { background-color: var(--wrp-background-secondary) !important; }
    .wr_page_reader .readerCatalog { color: var(--wrp-text-normal) !important; }
    .wr_page_reader .readerCatalog_bookInfo_title, .wr_page_reader .readerCatalog_list_item:not(.readerCatalog_list_item_selected) { color: var(--wrp-text-normal) !important; }
    .wr_page_reader .readerCatalog_searchBar input, .wr_page_reader .readerCatalog_list_item_meta { color: var(--wrp-text-muted) !important; }
    :root::-webkit-scrollbar, .wr_page_reader::-webkit-scrollbar, .wr_page_reader ::-webkit-scrollbar { width: 10px; height: 10px; }
    :root::-webkit-scrollbar-track, .wr_page_reader::-webkit-scrollbar-track, .wr_page_reader ::-webkit-scrollbar-track,
    :root::-webkit-scrollbar-corner, .wr_page_reader::-webkit-scrollbar-corner, .wr_page_reader ::-webkit-scrollbar-corner { background: var(--wrp-background-primary); }
    :root::-webkit-scrollbar-thumb, .wr_page_reader::-webkit-scrollbar-thumb, .wr_page_reader ::-webkit-scrollbar-thumb { background: var(--wrp-text-muted); border: 2px solid var(--wrp-background-primary); border-radius: 6px; }
  `;
}
const HIDE_BOTTOM_BAR_CSS = `
  .wr_page_reader .readerBottomBar { display: none !important; }
`;
const COMPACT_CSS = `
  .wr_page_reader .readerTopBar, .wr_page_reader .readerControls { display: none !important; }
  .wr_page_reader .app_content > .navBarOffset { display: none !important; padding: 0 !important; height: 0 !important; }
  .wr_page_reader .readerChapterContent { padding-top: 12px !important; }
`;
const WIDE_CSS = `
  .wr_page_reader .readerTopBar { display: none !important; }
  .wr_page_reader .app_content > .navBarOffset { display: none !important; padding: 0 !important; height: 0 !important; }
  .wr_page_reader .app_content { width: 100% !important; max-width: none !important; box-sizing: border-box !important; }
  .wr_page_reader .readerTopBar, .wr_page_reader .readerContentHeader,
  .wr_page_reader :not(.renderTargetPageInfo) > .readerFooter { width: 100% !important; max-width: none !important; box-sizing: border-box !important; margin-left: 0 !important; margin-right: 0 !important; }
  .wr_page_reader :not(.renderTargetPageInfo) > .readerFooter { left: 0 !important; right: 0 !important; }
  /* Native responsive margins plus a forced 100% width overflow on desktop.
     Let the block fill its parent, and let WeRead size and redraw its canvases. */
  .wr_page_reader .readerChapterContent { width: auto !important; max-width: none !important; margin-left: 0 !important; margin-right: 0 !important; box-sizing: border-box !important; }
  .wr_page_reader .readerControls { margin: 0 !important; right: 20px !important; z-index: 20 !important; background: var(--wrp-controls-background, rgba(255,255,255,.96)) !important; border-radius: 28px !important; padding: 4px 0 !important; box-shadow: 0 2px 16px rgba(0,0,0,.08) !important; }
`;
const NATIVE_READER_CSS = `
  /* Absolute text and popular underlines must use the same paginated box. */
  .wr_page_reader .wr_horizontalReader .readerChapterContent_container { padding: 0 !important; box-sizing: border-box !important; }
  .wr_page_reader .wr_horizontalReader .readerChapterContent { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; }
`;
const CHAPTER_NAV_CSS = `
  /* Native page headings and controls occupy their own canvas margins. */
  .wr_page_reader .wr_horizontalReader .renderTargetPageInfo { padding-top: 0 !important; }
  .wr_page_reader .wr_horizontalReader .renderTargetPageInfo_header { top: 4px !important; height: 24px !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; display: flex !important; align-items: center !important; gap: 8px !important; box-sizing: border-box !important; overflow: hidden !important; font-size: 12px !important; line-height: 18px !important; }
  .wr_page_reader .wr_horizontalReader .renderTargetPageInfo_header_chapterTitle { min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-size: inherit !important; line-height: inherit !important; }
  @media (max-height: 160px) { .wr_page_reader .wr_horizontalReader .renderTargetPageInfo_header { display: none !important; } }
  .wr_page_reader .readerContentHeader { width: 100% !important; max-width: none !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 4px 12px 2px !important; box-sizing: border-box !important; }
  /* Paginated footers live in an absolute page-info overlay; retain their native geometry. */
  .wr_page_reader :not(.renderTargetPageInfo) > .readerFooter { height: auto !important; min-height: 0 !important; margin-top: 8px !important; padding: 6px 12px 8px !important; box-sizing: border-box !important; }
  .wr_page_reader .readerContentHeader .readerHeaderButton, .wr_page_reader :not(.renderTargetPageInfo) > .readerFooter .readerFooter_button { display: block !important; width: fit-content !important; min-width: 64px !important; max-width: 100% !important; height: 24px !important; min-height: 0 !important; margin: 0 auto !important; padding: 3px 10px !important; box-sizing: border-box !important; border: 0 !important; border-radius: 4px !important; font-size: 12px !important; font-weight: 400 !important; line-height: 18px !important; color: var(--wrp-text-muted) !important; background: transparent !important; box-shadow: none !important; }
  .wr_page_reader .readerContentHeader .readerHeaderButton:hover, .wr_page_reader :not(.renderTargetPageInfo) > .readerFooter .readerFooter_button:hover { color: var(--wrp-text-normal) !important; background: var(--wrp-background-secondary) !important; }
  .wr_page_reader .readerContentHeader .readerHeaderButton:focus-visible, .wr_page_reader :not(.renderTargetPageInfo) > .readerFooter .readerFooter_button:focus-visible { outline: 1px solid var(--wrp-text-muted) !important; outline-offset: 2px !important; }
`;
const LITERATURE_CSS = `
  .wr_page_reader.wrp-literature-mode .readerChapterContent > .chapterTitle { display:none !important; }
  .wrp-literature-cards .wrp-literature-english { color:var(--wrp-text-normal); }
`;
const NOTES_PANEL_CSS = `
  :root.wrp-notes-open { overflow-y:hidden !important; scrollbar-gutter:stable !important; }
  .wr_page_reader .readerReviewDetailPanel { max-width:100vw !important; max-height:100vh !important; box-sizing:border-box !important; }
  .wr_page_reader .readerReviewDetailPanel_bg { position:relative; width:100% !important; box-sizing:border-box !important; max-height:calc(100vh - 48px) !important; overflow-y:auto !important; overscroll-behavior-y:contain !important; background:var(--wrp-background-secondary) !important; color:var(--wrp-text-normal) !important; }
  .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item { margin-bottom:12px !important; }
  .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item:last-child { margin-bottom:0 !important; }
  .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item > .actions { display:none !important; }
  .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item > .title { font-size:14px !important; line-height:20px !important; }
  .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item > .title .name { font-size:inherit !important; line-height:inherit !important; }
  .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item > .content { margin-top:6px !important; max-height:none !important; overflow:visible !important; overflow-wrap:anywhere; font-size:16px !important; line-height:1.6 !important; letter-spacing:normal !important; word-spacing:normal !important; }
  .wr_page_reader .wrp-notes-close { position:sticky; top:0; float:right; z-index:1; width:20px; height:20px; margin:-8px -8px 0 4px; padding:0; border:0; border-radius:3px; font:16px/20px sans-serif; color:var(--wrp-text-muted); background:var(--wrp-background-secondary); cursor:pointer; }
  .wr_page_reader .wrp-notes-close:hover { color:var(--wrp-text-normal); }
  @media (max-width:560px), (max-height:420px) {
    .wr_page_reader .readerReviewDetailPanel { left:0 !important; right:0 !important; bottom:0 !important; top:auto !important; width:100% !important; padding:0 4px 4px !important; }
    .wr_page_reader .readerReviewDetailPanel_bg { max-height:calc(100vh - 8px) !important; padding:12px !important; border:1px solid var(--wrp-border); border-radius:4px; }
    .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item > .title { font-size:12px !important; line-height:18px !important; }
    .wr_page_reader .readerReviewDetailPanel .readerReviewDetail_item > .content { font-size:14px !important; }
  }
`;
function controlsCss(position, padding) {
  const gutter = Math.max(4, Math.min(320, Number(padding) || 64));
  // Account for the native scrollbar; retain 240px of text in narrow tabs.
  const responsiveGutter = `min(${gutter}px, max(4px, calc((100vw - 15px - 240px) / 2)))`;
  const symmetric = `.wr_page_reader .readerChapterContent { width: auto !important; max-width: none !important; margin-left: 0 !important; margin-right: 0 !important; box-sizing: border-box !important; padding-left: ${responsiveGutter} !important; padding-right: ${responsiveGutter} !important; }`;
  if(position === 'left') return `.wr_page_reader .readerControls { left: 20px !important; right: auto !important; } ${symmetric}`;
  if(position === 'hidden') return `.wr_page_reader .readerControls { display: none !important; } ${symmetric}`;
  return `.wr_page_reader .readerControls { right: 20px !important; left: auto !important; } ${symmetric}`;
}
function miniCatalogCss(size) {
  const font = Math.max(10, Math.min(16, Number(size) || 12));
  return `
    .wr_page_reader .readerCatalog { inset: 0 !important; width: 100% !important; max-width: none !important; height: 100vh !important; max-height: 100vh !important; margin: 0 !important; border-radius: 0 !important; display: flex; flex-direction: column; box-sizing: border-box !important; overflow: hidden !important; font-size: ${font}px !important; }
    .wr_page_reader .readerCatalog_searchBar { flex: 0 0 auto !important; width: 100% !important; height: 36px !important; min-height: 0 !important; margin: 0 !important; padding: 4px 8px !important; box-sizing: border-box !important; }
    .wr_page_reader .readerCatalog_searchBar_inner { width: 100% !important; height: 28px !important; min-height: 0 !important; border-radius: 14px !important; }
    .wr_page_reader .readerCatalog_searchBar input { min-width: 0 !important; height: 28px !important; padding: 0 4px !important; font-size: ${font}px !important; line-height: 28px !important; }
    .wr_page_reader .readerCatalog_searchBar_inner_icon { flex: 0 0 16px !important; width: 16px !important; height: 16px !important; margin: 0 6px !important; background-size: contain !important; }
    .wr_page_reader .readerCatalog_bookInfo { flex: 0 0 auto !important; width: 100% !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 10px !important; box-sizing: border-box !important; }
    .wr_page_reader .readerCatalog_bookInfo_right { width: 100% !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
    .wr_page_reader .readerCatalog_bookInfo_title { display: flex !important; align-items: center; height: 22px !important; margin: 0 !important; font-size: ${font + 1}px !important; line-height: 22px !important; }
    .wr_page_reader .readerCatalog_bookInfo_title_txt { display: block !important; min-width: 0; max-height: 22px !important; font-size: inherit !important; line-height: 22px !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }
    .wr_page_reader .readerCatalog_bookInfo_cover, .wr_page_reader .readerCatalog_bookInfo_author, .wr_page_reader .readerCatalog_bookInfo_updateTime { display: none !important; }
    .wr_page_reader .readerCatalog_actions { flex: 0 0 auto !important; width: 100% !important; height: 24px !important; min-height: 0 !important; padding: 0 8px !important; margin: 0 !important; box-sizing: border-box !important; font-size: ${font}px !important; }
    .wr_page_reader .readerCatalog_actions_inner { height: 24px !important; min-height: 0 !important; font-size: inherit !important; }
    .wr_page_reader .readerCatalog .readerCatalog_list_scroll_area { flex: 1 1 0% !important; width: 100% !important; height: auto !important; min-height: 0 !important; overflow-x: hidden !important; overflow-y: auto !important; overscroll-behavior: contain; scrollbar-width: thin; }
    .wr_page_reader .readerCatalog_list_scroll_area .ps__rail-x, .wr_page_reader .readerCatalog_list_scroll_area .ps__rail-y { display: none !important; }
    .wr_page_reader .readerCatalog_list { margin: 0 !important; padding: 0 !important; }
    .wr_page_reader .readerCatalog_list_item { font-size: ${font}px !important; line-height: 1.5 !important; }
    .wr_page_reader .readerCatalog_list_item_inner { height: auto !important; margin: 0 !important; padding: 6px 10px !important; font-size: inherit !important; line-height: inherit !important; box-sizing: border-box !important; }
    .wr_page_reader .readerCatalog_list_item_info, .wr_page_reader .readerCatalog_list_item_title, .wr_page_reader .readerCatalog_list_item_title_text { font-size: inherit !important; line-height: inherit !important; }
    .wr_page_reader .readerCatalog_list_item_meta { height: auto !important; margin-top: 2px !important; font-size: ${Math.max(10, font - 1)}px !important; line-height: 1.4 !important; }
    .wr_page_reader .readerCatalog_list_item_meta_progress { font-size: inherit !important; line-height: inherit !important; }
    @media (max-height: 140px) { .wr_page_reader .readerCatalog_bookInfo, .wr_page_reader .readerCatalog_actions { display: none !important; } }
  `;
}
function cleanUserAgent() {
  return navigator.userAgent.replace(/\s(obsidian|electron)\/[^\s]+/gi, '').replace(/\s{2,}/g, ' ').trim();
}
function officialUrl(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'weread.qq.com' || u.hostname.endsWith('.weread.qq.com')); }
  catch { return false; }
}
function loginUrl(raw) {
  if (officialUrl(raw)) return true;
  try { const u = new URL(raw); return u.protocol === 'https:' && u.hostname === 'open.weixin.qq.com' && u.pathname.startsWith('/connect/qrconnect'); }
  catch { return false; }
}
function bookmarkUrl(raw) {
  if (!officialUrl(raw)) return null;
  const u = new URL(raw);
  return /^\/web\/reader\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname) ? u.origin + u.pathname : null;
}
function fitRect(rect, viewport) {
  const width = Math.min(Math.max(280, Number(rect.width) || 380), Math.max(180, viewport.width - 24));
  const height = Math.min(Math.max(180, Number(rect.height) || 280), Math.max(140, viewport.height - 48));
  return { width, height,
    x: Math.max(8, Math.min(Number.isFinite(rect.x) ? rect.x : viewport.width - width - 24, viewport.width - width - 8)),
    y: Math.max(8, Math.min(Number.isFinite(rect.y) ? rect.y : viewport.height - height - 42, viewport.height - height - 8)) };
}
class Pocket extends Plugin {
  async onload() {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    for(const retired of ['apiKey','apiFolder','mode']) delete this.settings[retired];
    this.initLocalBooks();
    this.settings.lineHeight = Math.round(Math.max(1, Math.min(3, Number(this.settings.lineHeight) || 1.9)) * 10) / 10;
    this.settings.layoutProfiles = normalizedLayoutProfiles(this.settings);
    this.settings.cardLayoutProfiles = normalizedCardProfiles(this.settings);
    this.settings.literatureLocations = normalizedLiteratureLocations(this.settings);
    this.settings.underlineProfiles = normalizedUnderlineProfiles(this.settings);
    this.settings.literatureTitle = String(this.settings.literatureTitle ?? LITERATURE_DEFAULTS.title).slice(0,160);
    this.settings.literatureEnglish = String(this.settings.literatureEnglish ?? LITERATURE_DEFAULTS.english).slice(0,12000);
    this.settings.literatureParagraphs = Math.max(1,Math.min(6,Math.round(Number(this.settings.literatureParagraphs)||3)));
    for(const key of ['pocketToolbarPosition','dockToolbarPosition']) if(!Object.hasOwn(POCKET_TOOLBAR_POSITIONS,this.settings[key])) this.settings[key]=DEFAULTS[key];
    for(const key of ['pocketHideTrigger','dockHideTrigger']) if(!['leave','click'].includes(this.settings[key])) this.settings[key]=DEFAULTS[key];
    if(!['hover','click'].includes(this.settings.dockExpandTrigger)) this.settings.dockExpandTrigger=DEFAULTS.dockExpandTrigger;
    if(!['auto', 'dark', 'light'].includes(this.settings.appearance)) this.settings.appearance = 'auto';
    this.unloaded = false;
    this.appearanceEpoch = Date.now();
    if (!officialUrl(this.settings.lastUrl)) this.settings.lastUrl = HOME;
    this.visible = false; this.expanded = false; this.ready = false; this.activateLayoutProfile(); this.updateFontButtons();
    try { this.registerView('weread-pocket-reader-v2', leaf => new ReaderView(leaf, this)); }
    catch (e) { this.viewRegistrationError = String(e); }
    this.registerView('weread-pocket-dock-v1', leaf => new PocketDockView(leaf, this));
    this.addCommand({ id: 'toggle', name: READER_TOGGLE_NAME, hotkeys: COMMAND_HOTKEYS.toggle, callback: () => this.toggle() });
    for(const [id,command] of Object.entries(READER_NAVIGATION_COMMANDS)) {
      this.addCommand({id,name:command.name,hotkeys:COMMAND_HOTKEYS[id],callback:()=>this.performReaderNavigation(id)});
    }
    const oldHideId=this.commandId('hide'),hotkeys=this.app.hotkeyManager;
    if(hotkeys?.getHotkeys?.(oldHideId)!==undefined) {hotkeys.removeHotkeys(oldHideId);await hotkeys.save();}
    this.addCommand({ id: 'expand', name: '放大 / 缩小阅读小窗', callback: () => { if (!this.visible) this.show(); this.expand(); } });
    this.addCommand({ id: 'sidebar', name: '在右侧栏阅读', callback: () => this.openReaderSidebar() });
    this.addCommand({ id: 'dock-pocket', name: '切换小窗固定到右侧栏底部', callback: () => this.setPocketDock(!this.settings.dockPocket) });
    this.addCommand({ id: 'font-smaller', name: '减小正文字号', callback: () => this.adjustFontSize(-1) });
    this.addCommand({ id: 'font-larger', name: '增大正文字号', callback: () => this.adjustFontSize(1) });
    this.addCommand({ id: 'read-scroll', name: '使用连续滚动阅读', callback: () => this.setReadingFlow('scroll') });
    this.addCommand({ id: 'read-paged', name: '使用分页阅读', callback: () => this.setReadingFlow('paged') });
    this.addCommand({ id: 'catalog', name: '打开章节目录', callback: () => this.openCatalog() });
    this.addCommand({ id:'literature', name:'切换当前位置的文献卡片外观', callback:()=>this.setLiteratureDisguise(!this.isLiteratureEnabled()) });
    this.addCommand({id:'local-shelf',name:'打开本地书架',callback:()=>this.showBookshelf()});
    this.addCommand({id:'import-local-books',name:'添加本地图书（EPUB / TXT）',callback:()=>this.importLocalFiles()});
    this.addCommand({id:'local-library-folder',name:'打开本地图书文件夹',callback:()=>this.revealLocalLibraryFolder()});
    this.addCommand({ id: 'shelf', name: '打开微信读书书架 / 登录', callback: () => { this.show(); if (!this.expanded) this.expand(); this.navigatePage(HOME); } });
    this.addCommand({ id: 'reset-position', name: '重置小窗位置', callback: () => this.resetPocketBounds() });
    this.launchButton=this.addRibbonIcon('book-open', '微信读书 · 收起 / 恢复', () => this.toggle());
    this.addRibbonIcon('panel-right-open', '微信读书 · 在右侧栏阅读', () => this.openReaderSidebar());
    this.status = this.addStatusBarItem?.();
    if(this.status) {
      this.status.addClass('wrp-launcher'); this.status.setText('阅');
      this.status.setAttribute('role', 'button'); this.status.tabIndex = 0;
      this.registerDomEvent(this.status, 'click', () => this.toggle());
      this.registerDomEvent(this.status, 'keydown', e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); } });
    }
    if(typeof window !== 'undefined') {
      this.registerDomEvent(window, 'resize', () => { if(this.panel && !this.readerLeaf) this.layout(); this.requestReadingSurfaceLayout(); });
      this.registerDomEvent(document, 'scroll', () => this.requestReadingSurfaceLayout(), { capture: true, passive: true });
      this.registerDomEvent(window, 'blur', () => this.deferBlurHide());
      this.registerDomEvent(document, 'pointermove', e => this.trackPocketPointer(e), { capture: true, passive: true });
      this.registerDomEvent(document, 'pointerdown', e => this.handlePocketPointerDown(e), {capture:true,passive:true});
      this.registerDomEvent(document, 'pointercancel', () => {this.pocketExpandClickPending=false;}, {capture:true,passive:true});
    }
    // Remove stale instances left by a development reload. Obsidian's
    // removal API takes the tab object, rather than its plugin id.
    const settingsManager = this.app.setting;
    const oldTabs = Array.isArray(settingsManager?.pluginTabs) ? [...settingsManager.pluginTabs] : [];
    for(const tab of oldTabs) {
      if(tab.id === this.manifest?.id) settingsManager.removeSettingTab?.(tab);
    }
    this.addSettingTab(new PocketSettings(this.app, this));
    this.updateShortcutHints();
    this.observeHostTheme();
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      if(this.unloaded) return;
      this.readerView?.updateLocation();
      if(this.activateLayoutProfile()) void this.applyAppearance();
      this.requestReadingSurfaceLayout();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.requestReadingSurfaceLayout()));
    this.readerHeaderTimer = setInterval(() => { if(this.readerView && this.expanded && this.ready && !this.unloaded) void this.refreshReaderHeader(); }, 1200);
    this.app.workspace.onLayoutReady(() => {
      if(this.unloaded) return;
      void this.initializeLocalLibrary().catch(error=>new Notice(`本地图书文件夹初始化失败：${error.message||error}`));
      for(const leaf of this.app.workspace.getLeavesOfType('weread-pocket-dock-v1')) {
        if(leaf !== this.dockLeaf) leaf.detach();
      }
      if(this.settings.dockPocket && !this.readerLeaf) this.show();
      else if(!this.settings.dockPocket) this.releasePocketDock();
    });
  }
  persist() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => { this.saveData(this.settings).catch(() => new Notice('小窗设置保存失败')); }, 250); }
  layoutProfileKey(location) {
    if(typeof location === 'string' && Object.hasOwn(LAYOUT_LABELS, location)) return location;
    if(location === true || (location === undefined && !this.expanded)) return this.settings.dockPocket ? 'dock' : 'floating';
    return this.isReaderInSidebar() ? 'sidebar' : 'tab';
  }
  isLiteratureEnabled(location) {
    const key=this.layoutProfileKey(location),saved=this.settings.literatureLocations?.[key];
    return typeof saved === 'boolean' ? saved : !!this.settings.literatureDisguise;
  }
  underlineProfileMode(location, mode) {
    return mode === 'reading' || mode === 'card' ? mode : this.isLiteratureEnabled(location) ? 'card' : 'reading';
  }
  isPopularUnderlinesEnabled(location, mode) {
    const key = this.layoutProfileKey(location), profileMode = this.underlineProfileMode(key, mode);
    const saved = this.settings.underlineProfiles?.[profileMode]?.[key];
    return typeof saved === 'boolean' ? saved : this.settings.showPopularUnderlines !== false;
  }
  layoutProfile(location) {
    if(this.isLiteratureEnabled(location)) {
      if(!this.settings.cardLayoutProfiles) this.settings.cardLayoutProfiles=normalizedCardProfiles(this.settings);
      return this.settings.cardLayoutProfiles[this.layoutProfileKey(location)];
    }
    if(!this.settings.layoutProfiles) this.settings.layoutProfiles = normalizedLayoutProfiles(this.settings);
    return this.settings.layoutProfiles[this.layoutProfileKey(location)];
  }
  typographyPreferenceKey() {
    const key = this.layoutProfileKey(), profile = this.layoutProfile(key);
    return `${this.isLiteratureEnabled()?'card':'reading'}:${key}:${profile.fontSizePx}:${profile.lineHeight}:${profile.paragraphSpacing}`;
  }
  activateLayoutProfile() {
    const key = this.layoutProfileKey(), profile = this.layoutProfile(key), identity=`${this.isLiteratureEnabled()?'card':'reading'}:${key}`, changed = this.activeLayoutProfile !== identity;
    this.activeLayoutProfile = identity;
    // Keep legacy aliases for existing settings files and local integrations.
    Object.assign(this.settings, { fontSizePx: profile.fontSizePx, fontSizeLevel: Math.max(1, FONT_SIZES.indexOf(profile.fontSizePx) - 3), lineHeight: profile.lineHeight, paragraphSpacing: profile.paragraphSpacing, contentPadding: this.layoutProfile(false).contentPadding, miniContentPadding: this.layoutProfile(true).contentPadding });
    if(changed) { this.nativeFontSize = profile.fontSizePx; this.nativeFontReady = false; }
    return changed;
  }
  async setProfileOption(location, field, value) {
    const key = this.layoutProfileKey(location);
    if(key === this.layoutProfileKey()) {
      if(field === 'fontSizePx') return this.setFontSize(value);
      if(field === 'lineHeight') return this.setLineHeight(value);
      if(field === 'paragraphSpacing') return this.setParagraphSpacing(value);
      if(field === 'contentPadding') return this.setContentPadding(value, key);
    }
    const profile = this.layoutProfile(key);
    if(field === 'fontSizePx') { if(!FONT_SIZES.includes(Number(value))) return false; profile.fontSizePx = Number(value); }
    else if(field === 'lineHeight') profile.lineHeight = Math.round(Math.max(1, Math.min(3, Number(value) || 1.9)) * 10) / 10;
    else if(field === 'paragraphSpacing') profile.paragraphSpacing = Math.max(0, Math.min(80, Number(value) || 0));
    else if(field === 'contentPadding') profile.contentPadding = Math.max(4, Math.min(320, Number(value) || 4));
    else return false;
    this.activateLayoutProfile(); this.updateLayoutControls(); this.persist(); return true;
  }
  resolvedTheme() {
    if(this.settings.appearance === 'dark' || this.settings.appearance === 'light') return this.settings.appearance;
    return typeof document !== 'undefined' && document.body?.classList.contains('theme-dark') ? 'dark' : 'light';
  }
  readingPalette() {
    const theme = this.resolvedTheme(), palette = { theme, ...THEME_COLORS[theme] };
    if(typeof document === 'undefined' || !document.body || typeof getComputedStyle !== 'function') return palette;
    const hostTheme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    if(theme !== hostTheme) return palette;
    // Resolve the main workspace's CSS variables, including hsl/calc values.
    // Never sample our own fixed-theme overrides when switching back to auto.
    const source = document.querySelector('.workspace-split.mod-root .workspace-leaf-content[data-type="markdown"]')
      || document.querySelector('.workspace-split.mod-root .workspace-leaf-content:not(.wrp-reader-view)') || document.body;
    const sourceStyle = getComputedStyle(source), probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;';
    source.appendChild(probe);
    try {
      for(const [key, variable] of Object.entries(THEME_VARIABLES)) {
        const value = sourceStyle.getPropertyValue(variable).trim();
        if(!value || !CSS.supports('color', value)) continue;
        probe.style.backgroundColor = value;
        const resolved = getComputedStyle(probe).backgroundColor;
        if(resolved && (!['primary', 'secondary', 'text'].includes(key) || resolved !== 'rgba(0, 0, 0, 0)')) palette[key] = resolved;
      }
    } finally { probe.remove(); }
    return palette;
  }
  updateHostTheme(palette = this.readingPalette()) {
    const mode = this.settings.appearance || 'auto', theme = palette.theme;
    this.themePaletteSignature = JSON.stringify(palette);
    for(const root of [this.panel, this.readerView?.containerEl, this.readingSurface]) {
      root?.setAttribute('data-wrp-theme-mode', mode);
      root?.setAttribute('data-wrp-theme', theme);
      for(const [key, variable] of Object.entries(THEME_VARIABLES)) root?.style?.setProperty(variable, palette[key]);
    }
  }
  observeHostTheme() {
    if(typeof document === 'undefined' || !document.body || typeof MutationObserver === 'undefined') return;
    const changed = () => {
      clearTimeout(this.themeRefreshTimer);
      this.themeRefreshTimer = setTimeout(() => {
        if(!this.unloaded && JSON.stringify(this.readingPalette()) !== this.themePaletteSignature) this.applyAppearance();
      }, 80);
    };
    this.themeObserver = new MutationObserver(changed);
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    if(this.app.workspace?.on && this.registerEvent) this.registerEvent(this.app.workspace.on('css-change', changed));
  }
  setThemeMode(mode) {
    if(!['auto', 'dark', 'light'].includes(mode)) return Promise.resolve(false);
    this.settings.appearance = mode;
    this.persist();
    return this.applyAppearance();
  }
  button(parent, icon, label, action, owner = this) {
    const b = parent.createEl('button', { cls: 'wrp-button', attr: { 'aria-label': label, title: label, type: 'button' } });
    setIcon(b, icon); owner.registerDomEvent(b, 'click', e => { e.stopPropagation(); action(e); }); return b;
  }
  addFontButtons(parent, owner = this) {
    this.fontButtons = this.fontButtons || [];
    for(const delta of [-1, 1]) {
      const label = delta < 0 ? '减小正文字号' : '增大正文字号';
      const button = parent.createEl('button', { cls: 'wrp-button wrp-font-button', text: delta < 0 ? 'A−' : 'A+', attr: { type: 'button', 'aria-label': label, title: label } });
      owner.registerDomEvent(button, 'click', event => { event.stopPropagation(); this.adjustFontSize(delta); });
      this.fontButtons.push({ button, delta, root: parent.closest('.wrp-reader-view,.wrp-panel') || parent });
    }
    this.updateFontButtons();
  }
  addLayoutControls(toolbar, root, pocket = false, owner = this) {
    const entry = { pocket, root, rows: [] };
    const button = this.button(toolbar, 'sliders-horizontal', '展开排版设置', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      button.classList.toggle('is-active', !panel.hidden);
      button.title = panel.hidden ? '展开排版设置' : '收起排版设置';
      button.setAttribute('aria-label', button.title);
      if(this.dockCollapsed && pocket) this.setPocketDockCollapsed(false);
    }, owner);
    button.classList.add('wrp-layout-toggle');
    this.layoutPanelId = (this.layoutPanelId || 0) + 1;
    const panel = root.createDiv({ cls: 'wrp-layout-panel', attr: { id: `wrp-layout-${this.appearanceEpoch}-${this.layoutPanelId}` } });
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', panel.id);
    for(const [kind, label] of [['font', '字号'], ['line', '行间距'], ['paragraph', '段间距'], ['padding', '左右留白']]) {
      const row = panel.createDiv({ cls: 'wrp-layout-row' });
      row.createSpan({ cls: 'wrp-layout-label', text: label });
      const adjust = delta => kind === 'font' ? this.adjustFontSize(delta) : kind === 'line' ? this.adjustLineHeight(delta) : kind === 'paragraph' ? this.adjustParagraphSpacing(delta) : this.adjustContentPadding(delta, pocket);
      const minus = this.button(row, 'minus', kind === 'padding' ? '同时减小左右留白' : '减小' + label, () => adjust(-1), owner);
      const value = row.createSpan({ cls: 'wrp-layout-value', attr: { 'aria-live': 'polite' } });
      const plus = this.button(row, 'plus', kind === 'padding' ? '同时增大左右留白' : '增大' + label, () => adjust(1), owner);
      const defaultValue = this.defaultLayoutValue(kind, pocket);
      const reset = this.button(row, 'rotate-ccw', `恢复默认${label}（${defaultValue}${kind === 'line' ? '×' : ' px'}）`, () => this.resetLayoutOption(kind, pocket), owner);
      reset.addClass('wrp-layout-reset'); reset.setText('默认');
      entry.rows.push({ kind, value, minus, plus, reset });
    }
    entry.panel = panel;
    entry.button = button;
    this.layoutControls = (this.layoutControls || []).filter(control => control.panel.parentElement === control.root);
    this.layoutControls.push(entry);
    this.updateLayoutControls();
    return entry;
  }
  updateLayoutControls() {
    this.layoutControls = (this.layoutControls || []).filter(control => control.panel.parentElement === control.root);
    for(const entry of this.layoutControls) {
      const label = `${entry.panel.hidden ? '展开' : '收起'}排版设置 · ${LAYOUT_LABELS[this.layoutProfileKey(entry.pocket)]}`;
      entry.button.title = label; entry.button.setAttribute('aria-label', label);
    }
    for(const entry of this.layoutControls) for(const { kind, value, minus, plus, reset } of entry.rows) {
      const profile = this.layoutProfile(entry.pocket);
      const size = kind === 'font' ? profile.fontSizePx : kind === 'line' ? profile.lineHeight : kind === 'paragraph' ? profile.paragraphSpacing : profile.contentPadding;
      value.setText(kind === 'line' ? size.toFixed(1) + '×' : size + ' px');
      value.title = kind === 'padding' ? '左右各自的留白；最小 4 px，窄窗会限制最大留白以保留正文宽度' : kind === 'font' ? '正文字号' : kind === 'paragraph' ? '段落之间的总间隔，0 px 去掉原有段距；行间距单独调整' : '正文行高与字号的比例';
      const busy = kind !== 'padding' && (!!this.fontBusy || !this.ready || this.nativeFontReady === false);
      minus.disabled = busy || size <= (kind === 'font' ? FONT_SIZES[0] : kind === 'line' ? 1 : kind === 'paragraph' ? 0 : 4);
      plus.disabled = busy || size >= (kind === 'font' ? FONT_SIZES.at(-1) : kind === 'line' ? 3 : kind === 'paragraph' ? 80 : 320);
      reset.disabled = busy || size === this.defaultLayoutValue(kind, entry.pocket);
      const name={font:'字号',line:'行间距',paragraph:'段间距',padding:'左右留白'}[kind];
      reset.title=`恢复默认${name}（${this.defaultLayoutValue(kind,entry.pocket)}${kind==='line'?'×':' px'}）`;
      reset.setAttribute('aria-label',reset.title);
    }
  }
  defaultLayoutValue(kind, pocket = !this.expanded) {
    const key = this.layoutProfileKey(pocket);
    if(this.isLiteratureEnabled(key)) return cardDefaults()[{font:'fontSizePx',line:'lineHeight',paragraph:'paragraphSpacing',padding:'contentPadding'}[kind]];
    return kind === 'font' ? DEFAULT_FONT_SIZE : kind === 'line' ? DEFAULTS.lineHeight : kind === 'paragraph' ? 0 : DEFAULTS[key === 'floating' || key === 'dock' ? 'miniContentPadding' : 'contentPadding'];
  }
  resetLayoutOption(kind, pocket = !this.expanded) {
    const value = this.defaultLayoutValue(kind, pocket);
    const field = { font: 'fontSizePx', line: 'lineHeight', paragraph: 'paragraphSpacing', padding: 'contentPadding' }[kind];
    if(field) return this.setProfileOption(pocket, field, value);
    return false;
  }
  contentPadding(pocket = !this.expanded) {
    return this.layoutProfile(pocket).contentPadding;
  }
  setContentPadding(value, pocket = !this.expanded) {
    const key = this.layoutProfileKey(pocket);
    this.layoutProfile(key).contentPadding = Math.max(4, Math.min(320, Number(value) || 4));
    this.activateLayoutProfile(); this.updateLayoutControls(); this.persist();
    return key === this.layoutProfileKey() ? Promise.resolve(this.applyAppearance()).then(() => true) : Promise.resolve(true);
  }
  adjustContentPadding(delta, pocket) { return this.setContentPadding(this.contentPadding(pocket) + delta * 4, pocket); }
  async refreshReaderHeader() {
    if(this.readerHeaderTask) return this.readerHeaderTask;
    const view = this.readerView, webview = this.webview, navigation = this.navigationRevision;
    if(!view || !this.expanded || !this.ready || this.unloaded) return null;
    let deadline;
    const task = (async () => {
      try {
        const data = await Promise.race([webview.executeJavaScript(`(() => {
          const header = document.querySelector('.readerTopBar');
          const book = header?.querySelector('.readerTopBar_title_link');
          const add = header?.querySelector('.readerTopBar_addToShelf');
          return { title: book?.textContent.trim().slice(0,160) || '', addLabel: add?.textContent.trim().slice(0,60) || '', addDisabled: !add || add.disabled, loggedIn: !!header?.querySelector('.readerTopBar_avatar') };
        })()`), new Promise(resolve => { deadline = setTimeout(() => resolve(null), 1000); })]);
        if(!data || this.unloaded || this.readerView !== view || this.webview !== webview || navigation !== this.navigationRevision || !this.ready) return null;
        view.headerData = data;
        const title = this.isLiteratureEnabled() ? (this.settings.literatureTitle.trim() || LITERATURE_DEFAULTS.title) : (data.title || '微信读书');
        view.titleEl.setText(title);
        view.titleEl.title = title;
        view.addShelfButton.hidden = !data.addLabel;
        view.addShelfButton.disabled = data.addDisabled;
        view.addShelfButton.title = data.addLabel || '加入书架';
        view.addShelfButton.setAttribute('aria-label', view.addShelfButton.title);
        return data;
      } catch { return null; } finally { clearTimeout(deadline); }
    })();
    this.readerHeaderTask = task;
    try { return await task; } finally { if(this.readerHeaderTask === task) this.readerHeaderTask = null; }
  }
  async addCurrentBookToShelf() {
    if(!this.ready || !this.webview) return;
    try {
      const clicked = await this.webview.executeJavaScript(`(() => { const button = document.querySelector('.readerTopBar .readerTopBar_addToShelf'); if(!button || button.disabled) return false; button.click(); return true; })()`);
      if(!clicked) new Notice('当前书籍暂时无法加入书架');
      await this.refreshReaderHeader();
    } catch { new Notice('加入书架暂时不可用，请稍后重试'); }
  }
  literatureDockBounds() {
    if(!this.isLiteratureEnabled() || this.readingLocation() !== 'dock') return null;
    const surface=this.readingSurface?.getBoundingClientRect();
    const split=this.app?.workspace?.rightSplit?.containerEl;
    if(!surface || surface.width < 80 || !split?.querySelectorAll) return null;
    // An optional visible reference supplies the same sidebar card grid. No
    // text, notes or plugin state is read; ordinary mode keeps its own gutters.
    const reference=[...split.querySelectorAll('.zt-annot-card')].map(node=>node.getBoundingClientRect()).find(rect=>
      rect.width >= 80 && rect.bottom > 0 && rect.top < surface.top &&
      rect.left >= surface.left && rect.right <= surface.right);
    if(!reference) return null;
    const extra=Math.min(this.contentPadding()-cardDefaults().contentPadding, Math.max(0,(reference.width-Math.min(240,reference.width))/2));
    const round=value=>Math.round(value*64)/64;
    const left=round(Math.max(0,reference.left-surface.left+extra));
    const right=round(Math.min(surface.width,reference.right-surface.left-extra));
    return right-left >= 80 ? {left,right} : null;
  }
  literatureConfig() {
    const fontFamily=typeof document!=='undefined'&&document.body&&typeof getComputedStyle==='function'?getComputedStyle(document.body).fontFamily:'sans-serif';
    return { enabled:this.isLiteratureEnabled(), english:this.settings.literatureEnglish.trim() || LITERATURE_DEFAULTS.english, paragraphs:this.settings.literatureParagraphs,fontFamily,dockBounds:this.literatureDockBounds() };
  }
  async setPopularUnderlines(enabled, location = this.layoutProfileKey(), mode) {
    if(this.unloaded) return false;
    const key = this.layoutProfileKey(location), profileMode = this.underlineProfileMode(key, mode);
    this.settings.underlineProfiles = normalizedUnderlineProfiles(this.settings);
    this.settings.underlineProfiles[profileMode][key] = !!enabled;
    this.persist();
    if(key === this.layoutProfileKey() && profileMode === this.underlineProfileMode()) await this.applyAppearance();
    return true;
  }
  async setLiteratureDisguise(enabled, location = this.layoutProfileKey()) {
    if(this.unloaded) return false;
    const key=this.layoutProfileKey(location);
    if(enabled && key === this.layoutProfileKey() && this.ready && this.settings.readingFlow !== 'scroll') {
      if(!await this.setReadingFlow('scroll')) return false;
    }
    if(!this.settings.literatureLocations) this.settings.literatureLocations=normalizedLiteratureLocations(this.settings);
    this.settings.literatureLocations[key]=!!enabled;
    this.persist();
    if(key === this.layoutProfileKey()) {
      clearTimeout(this.literatureAppearanceTimer);
      this.activateLayoutProfile(); this.updateShortcutHints(); this.updateLayoutControls();
      await this.applyAppearance();
    }
    return true;
  }
  setLiteraturePreference(field,value) {
    if(!['literatureTitle','literatureEnglish','literatureParagraphs'].includes(field)) return;
    this.settings[field] = field==='literatureParagraphs' ? Math.max(1,Math.min(6,Math.round(Number(value)||3))) : String(value).slice(0,field==='literatureTitle'?160:12000);
    this.persist();
    if(field==='literatureTitle') {this.updateShortcutHints();void this.refreshReaderHeader();return;}
    clearTimeout(this.literatureAppearanceTimer);
    this.literatureAppearanceTimer = setTimeout(()=>{
      if(!this.unloaded && this.isLiteratureEnabled()) {this.updateShortcutHints();void this.applyAppearance();}
    },350);
  }
  updateFontButtons() {
    this.fontButtons = (this.fontButtons || []).filter(({ button, root }) => root ? root.contains(button) : button.isConnected);
    const size = this.nativeFontSize || this.settings.fontSizePx || FONT_SIZES[(Number(this.settings.fontSizeLevel) || 2) + 3];
    for(const { button, delta } of this.fontButtons) button.disabled = !!this.fontBusy || !this.ready || this.nativeFontReady === false || (delta < 0 ? size <= FONT_SIZES[0] : size >= FONT_SIZES[FONT_SIZES.length - 1]);
    this.updateLayoutControls();
  }
  async refreshFontControls() {
    clearTimeout(this.fontStateRetryTimer);
    if(!this.ready || !this.webview || this.unloaded) { this.updateFontButtons(); return null; }
    try {
      const state = await this.webview.executeJavaScript('typeof window.__wrpGetFontState === "function" ? window.__wrpGetFontState() : null');
      if(state && Number.isInteger(state.level) && FONT_SIZES.includes(state.size)) {
        this.nativeFontLevel = state.level;
        this.nativeFontSize = state.size;
        this.nativeFontReady = state.ready && state.preferenceKey === this.typographyPreferenceKey();
        if(this.nativeFontReady && !this.fontBusy && state.size !== this.layoutProfile().fontSizePx) {
          this.layoutProfile().fontSizePx = state.size; this.activateLayoutProfile(); this.persist();
          this.nativeFontReady = false; void this.syncNativeReaderPadding();
        }
        if(!this.nativeFontReady && this.visible) this.fontStateRetryTimer = setTimeout(() => this.refreshFontControls(), 400);
      } else { this.nativeFontReady = false; }
      this.updateFontButtons();
      return state;
    } catch { return null; }
  }
  adjustFontSize(delta) { return this.queueFontChange(delta, true); }
  setFontSize(size) { return this.queueFontChange(Number(size), false); }
  queueFontChange(value, relative) {
    return this.queueTypographyChange(value, relative, 'font');
  }
  setLineHeight(value) { return this.queueLineHeight(Number(value), false); }
  adjustLineHeight(delta) { return this.queueLineHeight(delta, true); }
  queueLineHeight(value, relative) {
    return this.queueTypographyChange(value, relative, 'line');
  }
  setParagraphSpacing(value) { return this.queueTypographyChange(Number(value), false, 'paragraph'); }
  adjustParagraphSpacing(delta) { return this.queueTypographyChange(delta, true, 'paragraph'); }
  queueTypographyChange(value, relative, kind) {
    const key = this.layoutProfileKey(), cardMode=!!this.isLiteratureEnabled();
    const task = (this.fontChangeTask || Promise.resolve()).then(() => this.changeTypography(value, relative, kind, key, cardMode));
    this.fontChangeTask = task.catch(() => false);
    return task;
  }
  changeFontSize(value, relative) { return this.changeTypography(value, relative, 'font'); }
  async changeTypography(value, relative, kind, expectedKey = this.layoutProfileKey(), expectedCardMode = !!this.isLiteratureEnabled()) {
    if(this.unloaded || expectedKey !== this.layoutProfileKey() || expectedCardMode !== !!this.isLiteratureEnabled()) return false;
    this.activateLayoutProfile();
    const label = kind === 'line' ? '行间距' : kind === 'paragraph' ? '段间距' : '字号';
    if(!this.ready || !this.webview) { new Notice('请先打开一本书，再调整' + label); return false; }
    this.fontBusy = true; this.updateFontButtons();
    const webview = this.webview, navigation = this.navigationRevision, generation = this.appearanceGeneration;
    const current = () => !this.unloaded && this.webview === webview && this.navigationRevision === navigation && this.appearanceGeneration === generation && this.layoutProfileKey() === expectedKey && expectedCardMode === !!this.isLiteratureEnabled();
    try {
      await this.syncNativeReaderPadding();
      let state = null;
      for(let attempt = 0; attempt < 40; attempt++) {
        if(!current()) return false;
        state = await this.refreshFontControls();
        if(!current()) return false;
        if(state?.ready && state.preferenceKey === this.typographyPreferenceKey()) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if(!state?.ready || state.preferenceKey !== this.typographyPreferenceKey()) { new Notice('正文尚未加载完成，请稍后调整' + label); return false; }
      const index = Math.max(0, Math.min(FONT_SIZES.length - 1, FONT_SIZES.indexOf(state.size) + value));
      const target = kind === 'line' ? Math.round(Math.max(1, Math.min(3, relative ? state.lineHeight + value * 0.1 : value)) * 10) / 10 : kind === 'paragraph' ? Math.max(0, Math.min(80, relative ? state.paragraphSpacing + value * 2 : value)) : relative ? FONT_SIZES[index] : value;
      if((kind === 'font' ? !FONT_SIZES.includes(target) : !Number.isFinite(target)) || !current()) return false;
      const setter = kind === 'line' ? '__wrpSetLineHeight' : kind === 'paragraph' ? '__wrpSetParagraphSpacing' : '__wrpSetFontSize';
      // Reparenting can discard an Electron callback. Release the old edit
      // when its position changes, so it cannot block edits in the new view.
      let deadline, staleTimer, accepted;
      try {
        const stale = new Promise(resolve => {
          const check = () => { if(!current()) resolve(false); else staleTimer = setTimeout(check, 100); };
          staleTimer = setTimeout(check, 100);
        });
        accepted = await Promise.race([webview.executeJavaScript("typeof window." + setter + " === 'function' && window." + setter + "(" + target + ")"), stale, new Promise(resolve => { deadline = setTimeout(() => resolve(false), 6000); })]);
      } finally { clearTimeout(deadline); clearTimeout(staleTimer); }
      if(!accepted) return false;
      for(let attempt = 0; attempt < 60; attempt++) {
        if(!current()) return false;
        state = await this.refreshFontControls();
        if(!current()) return false;
        if(state?.ready && (kind === 'line' ? state.lineHeight === target : kind === 'paragraph' ? state.paragraphSpacing === target : state.size === target)) {
          this.layoutProfile(expectedKey)[kind === 'font' ? 'fontSizePx' : kind === 'line' ? 'lineHeight' : 'paragraphSpacing'] = target;
          this.activateLayoutProfile();
          this.persist();
          await this.syncNativeReaderPadding();
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      new Notice(label + '重排尚未完成，请稍后重试');
      return false;
    } catch { new Notice(label + '暂时无法调整，请稍后重试'); return false; }
    finally { this.fontBusy = false; this.updateFontButtons(); }
  }
  build() {
    this.panel = document.body.createDiv({ cls: 'wrp-panel', attr: { role: 'region' } });
    const header = this.panel.createDiv({cls:'wrp-header'});
    this.button(header, 'chevron-left', '上一页（由官方阅读器处理）', () => this.turnPage('Left'));
    this.button(header, 'chevron-right', '下一页（由官方阅读器处理）', () => this.turnPage('Right'));
    const title = header.createSpan({cls:'wrp-title wrp-message', text:'加载中…', attr:{id:`wrp-pocket-label-${this.appearanceEpoch}`}});
    this.message = title;
    // Obsidian uses aria-label as a hover tooltip. Name the reading surface
    // through its visible heading instead, so hovering text stays unobstructed.
    this.panel.setAttribute('aria-labelledby', title.id);
    const tools = header.createDiv({cls:'wrp-pocket-tools'});
    this.registerDomEvent(tools, 'wheel', e => {
      if(['left','right'].includes(this.pocketToolbarPosition()) || tools.scrollWidth <= tools.clientWidth) return;
      const delta = e.deltaX || e.deltaY;
      if(delta) { e.preventDefault(); tools.scrollLeft += delta * (e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? tools.clientWidth : 1); }
    }, {passive:false});
    this.button(tools, 'library', '书架 · 切换正文来源', () => this.showBookshelf());
    this.button(tools, 'list', '打开章节目录', () => this.openCatalog());
    this.addFontButtons(tools);
    this.addLayoutControls(tools, this.panel, true);
    this.button(tools, 'rotate-cw', '重新加载官方页面', () => this.reloadPage());
    this.autoButton = this.button(tools, 'mouse-pointer-2', '移开鼠标自动收起（放大时暂停）', () => {
      if(this.settings.dockPocket) this.setDockAutoCollapse(!this.settings.dockAutoCollapse);
      else { this.settings.autoHide = !this.settings.autoHide; this.updateButtons(); this.persist(); }
    });
    this.expandButton = this.button(tools, 'maximize-2', '放大：登录、目录和原版工具栏', () => this.expand());
    this.dockButton = this.button(tools, 'panel-bottom', '固定小窗到右侧栏底部', () => this.setPocketDock(!this.settings.dockPocket));
    this.button(tools, 'panel-right-open', '移至右侧栏阅读', () => this.openReaderSidebar());
    this.pocketCloseButton=this.button(header, 'minus', '收起阅读器', () => this.hide());this.pocketCloseButton.addClass('wrp-pocket-close');
    const body = this.panel.createDiv({cls:'wrp-body'});
    this.body = body;
    this.navigationRevision ||= 0;
    this.mountWebview(body);
    if(!this.isLocalSource()) this.ensureWeReadWebview();
    this.registerDomEvent(this.panel, 'pointerenter', e => this.trackPocketPointer(e));
    this.registerDomEvent(header, 'pointerdown', e => {
      if(e.button!==0||!this.dockLeaf||!this.dockCollapsed||e.target.closest('.wrp-pocket-close')) return;
      this.pocketExpandClickPending=true;
      this.setPocketDockCollapsed(false);
      e.preventDefault();e.stopImmediatePropagation();
    },{capture:true});
    this.registerDomEvent(header, 'click', e => {
      if(e.target.closest('.wrp-pocket-close')) return;
      if(this.pocketExpandClickPending||(this.dockLeaf&&this.dockCollapsed)) {
        this.pocketExpandClickPending=false;this.setPocketDockCollapsed(false);
        e.preventDefault();e.stopImmediatePropagation();
      }
    },{capture:true});
    this.registerDomEvent(this.panel, 'pointerleave', e => {
      // Entering an Electron guest can look like leaving its host element.
      this.autoHideArmed = true;
      this.trackPocketPointer(e);
    });
    this.registerDomEvent(this.panel, 'keydown', e => { if(e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide(); } });
    this.registerDomEvent(header, 'pointerdown', e => {
      if(this.expanded || this.dockLeaf || e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault(); this.dragging = true; header.setPointerCapture(e.pointerId);
      const r = this.panel.getBoundingClientRect(); this.drag = {startX:e.clientX, startY:e.clientY, x:r.x, y:r.y};
    });
    this.registerDomEvent(header, 'pointermove', e => {
      if(!this.dragging) return;
      this.settings.x = this.drag.x + e.clientX - this.drag.startX; this.settings.y = this.drag.y + e.clientY - this.drag.startY;
      this.layout();
    });
    const stopDrag = () => { if(this.dragging) {this.dragging=false; this.persist();} };
    this.registerDomEvent(header, 'pointerup', stopDrag); this.registerDomEvent(header, 'pointercancel', stopDrag);
    this.resizeObserver = new ResizeObserver(() => {
      if(!this.visible || this.expanded) return;
      const r = this.panel.getBoundingClientRect();
      if(this.dockLeaf) {
        if(this.dockCollapsed) return;
        if(r.height > 100 && Math.round(r.height) !== this.settings.dockHeight) { this.settings.dockHeight = Math.round(r.height); this.persist(); }
        return;
      }
      if(r.width > 0 && r.height > 0) { this.settings.width = Math.round(r.width); this.settings.height = Math.round(r.height); this.persist(); }
    });
    this.resizeObserver.observe(this.panel); this.updateButtons(); this.layout();
    this.readerResizeObserver = new ResizeObserver(() => {
      if(!this.ready || this.dockCollapsed || (!this.expanded && !this.dockLeaf)) return;
      clearTimeout(this.reflowTimer);
      this.reflowTimer = setTimeout(() => this.refreshReaderLayout(), 160);
    });
    if(this.webview) this.readerResizeObserver.observe(this.webview);
  }
  ensureWeReadWebview() {
    if(this.webview || this.unloaded || this.isLocalSource() || !this.readingSurface) return this.webview;
    const webview = document.createElement('webview');
    this.webview = webview;
    this.ready = false; this.wereadReady = false;
    this.nativeFontReady = false; this.cssKey = null; this.styledNavigationRevision = -1;
    webview.setAttribute('partition', 'persist:weread-pocket');
    webview.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes');
    webview.setAttribute('useragent', cleanUserAgent());
    const label = this.surfaceHost?.parentElement?.querySelector('.wrp-reader-title') || this.panel?.querySelector('.wrp-title');
    if(label?.id) webview.setAttribute('aria-labelledby', label.id);
    webview.className = 'wrp-webview';
    // These listeners belong to this source, rather than the plugin lifetime.
    // Registering every recreated guest with registerDomEvent would retain it.
    const listeners = [];
    const active = () => this.webview === webview && !this.unloaded && !this.isLocalSource();
    const on = (name, callback) => {webview.addEventListener(name, callback);listeners.push([name, callback]);};
    this.webviewCleanup = () => {for(const [name,callback] of listeners)webview.removeEventListener(name,callback);};
    on('dom-ready', () => {if(this.webview!==webview||this.unloaded)return;this.wereadReady=true;if(!active())return;this.ready=true;this.cssKey=null;this.message.setText('官方页面 · 放大可登录');void this.applyAppearance();this.bindGuestKeys();});
    on('did-start-navigation', e => {
      if(this.webview!==webview||this.unloaded||e.isMainFrame===false||e.isInPlace)return;
      this.wereadReady=false;if(!active())return;this.ready=false;this.updateFontButtons();
      this.navigationRevision++;this.appearanceRevision=(this.appearanceRevision||0)+1;this.appearanceRetries=0;
      clearTimeout(this.appearanceRetryTimer);this.setAppearancePending(true);
    });
    on('did-start-loading', () => {if(active())this.message.setText('加载中…');});
    on('did-stop-loading', () => {if(!active())return;this.updateShortcutHints();clearTimeout(this.nativeLayoutRetryTimer);this.nativeLayoutRetryTimer=setTimeout(()=>{if(active())void this.refreshReaderLayout();},500);});
    on('did-fail-load', e => {if(active()&&e.errorCode!==-3&&e.isMainFrame!==false){this.message.setText('加载失败 · 点刷新重试');this.setAppearanceLoadingLabel('加载失败，请点击刷新');}});
    const remember = e => {if(!active())return;const url=bookmarkUrl(e.url);if(url){this.settings.lastUrl=url;this.persist();}};
    on('did-navigate', remember);
    on('did-navigate-in-page', e => {if(!active()||e.isMainFrame===false)return;remember(e);void this.applyAppearance();});
    on('focus', () => {if(active()){this.guestFocused=true;this.cancelAutoHide();}});
    on('blur', () => {if(active())this.guestFocused=false;});
    on('will-navigate', e => {if(!active())return;if(!loginUrl(e.url)){e.preventDefault();new Notice('小窗仅打开微信读书官方网页');}else this.setAppearancePending(true);});
    on('new-window', e => {e.preventDefault?.();if(active()&&loginUrl(e.url))this.navigatePage(e.url);});
    webview.src = bookmarkUrl(this.settings.lastUrl) || DEFAULTS.lastUrl;
    this.readingSurface.appendChild(webview);
    this.readerResizeObserver?.observe(webview);
    this.setAppearancePending(true);
    return webview;
  }
  releaseWeReadWebview() {
    const webview = this.webview;
    if(!webview) return;
    try {const url=bookmarkUrl(webview.getURL());if(url)this.settings.lastUrl=url;}catch{}
    this.navigationRevision=(this.navigationRevision||0)+1;
    this.appearanceRevision=(this.appearanceRevision||0)+1;this.appearanceGeneration=(this.appearanceGeneration||0)+1;
    for(const timer of ['appearanceRetryTimer','nativeLayoutRetryTimer','fontStateRetryTimer','reflowTimer']){clearTimeout(this[timer]);this[timer]=null;}
    this.unbindGuestKeys();this.webviewCleanup?.();this.webviewCleanup=null;
    this.readerResizeObserver?.unobserve?.(webview);
    this.webview=null;this.wereadReady=false;this.guestFocused=false;this.cssKey=null;
    this.nativeFontReady=false;this.styledNavigationRevision=-1;this.appearancePending=false;
    this.readingSurface?.classList.remove('wrp-is-loading');
    // Disconnecting the element destroys Electron's guest renderer. The
    // persistent partition keeps the login session without retaining a page.
    webview.remove();
  }
  bindGuestKeys() {
    // Electron guest keyboard events do not bubble to Obsidian's command system.
    this.unbindGuestKeys();
    try {
      const remote = require('@electron/remote');
      const guest = remote.webContents.fromId(this.webview.getWebContentsId());
      if(!guest) return;
      const handler = (event,input) => this.handleGuestKeyInput(event,input);
      guest.on('before-input-event', handler);
      // Guest pointer events do not reliably bubble through Electron's host DOM.
      const mouse = (event,input) => this.handleGuestMouseInput(input);
      guest.on('input-event',mouse);
      this.guestCleanup = () => { if(!guest.isDestroyed()) {guest.removeListener('before-input-event', handler);guest.removeListener('input-event',mouse);} };
    } catch {
      // The panel button and host hotkey remain available on restricted Electron builds.
      this.message.setText('点顶栏 − 收起；快捷键可在笔记区使用');
    }
  }
  unbindGuestKeys() { if(this.guestCleanup) { try {this.guestCleanup();} catch {} this.guestCleanup=null; } }
  commandId(command) { return `${this.manifest?.id||'weread-pocket'}:${command}`; }
  commandHotkeys(command) {
    const id=this.commandId(command),manager=this.app?.hotkeyManager;
    // An empty custom array intentionally disables the binding. Read on each
    // key press so changes in Obsidian's settings also apply inside the guest.
    return manager?.getHotkeys?.(id)??manager?.getDefaultHotkeys?.(id)??COMMAND_HOTKEYS[command]??[];
  }
  commandHotkeyLabel(command) {
    const manager=this.app?.hotkeyManager;
    if(manager?.printHotkeyForCommand) return manager.printHotkeyForCommand(this.commandId(command))||'未设置';
    return this.commandHotkeys(command).map(h=>[...h.modifiers.map(m=>m==='Mod'?(Platform?.isMacOS?'Cmd':'Ctrl'):m),h.key].join('+')).join(' / ')||'未设置';
  }
  handleReaderNavigationHotkey(event,input) {
    if(this.unloaded) return false;
    for(const [id,command] of Object.entries(READER_NAVIGATION_COMMANDS)) {
      if(!this.commandHotkeys(id).some(h=>matchesHotkey(input,h))) continue;
      event.preventDefault();event.stopPropagation?.();
      if(!input.isAutoRepeat||command.action==='scroll') void this.performReaderNavigation(id);
      return true;
    }
    return false;
  }
  handleGuestKeyInput(event,input) {
    if(this.unloaded||input.type!=='keyDown') return;
    const pass=this.readerInputPassThrough;
    if(pass&&Date.now()<pass.expires&&matchesHotkey(input,{key:pass.key,modifiers:pass.modifiers})) {pass.received=true;return;}
    if(!input.isAutoRepeat&&input.key==='Escape'&&this.visible) {event.preventDefault();this.quickHide();return;}
    if(this.commandHotkeys('toggle').some(h=>matchesHotkey(input,h))) {if(!input.isAutoRepeat){event.preventDefault();void this.toggle();}return;}
    this.handleReaderNavigationHotkey(event,input);
  }
  performReaderNavigation(command) {
    const control=READER_NAVIGATION_COMMANDS[command];
    if(!control||this.unloaded||!this.ready) return Promise.resolve(false);
    return control.action==='scroll'?this.scrollReader(control.direction):this.navigateReaderChapter(control.direction);
  }
  scrollReader(direction) {
    if(this.readerScrollTask) return Promise.resolve(false);
    const target=this.isLocalSource()?this.localReader:this.webview;
    const task=Promise.resolve().then(()=>target===(this.isLocalSource()?this.localReader:this.webview)?this.changeReaderScroll(direction):false).catch(()=>false);
    this.readerScrollTask=task;
    task.finally(()=>{if(this.readerScrollTask===task)this.readerScrollTask=null;});return task;
  }
  async changeReaderScroll(direction) {
    const webview=this.webview;
    if(this.unloaded||!this.ready||!webview||![-1,1].includes(direction)) return false;
    const result=await webview.executeJavaScript('('+officialReaderNavigation.toString()+')('+JSON.stringify('scroll')+','+direction+')');
    if(this.unloaded||webview!==this.webview||!this.ready) return false;
    if(result?.paged) {
      const key=direction<0?'Left':'Right';
      // Unlike the toolbar turnPage(), remote controls leave focus in the host.
      return this.sendReaderNativeInput(webview,key,[]);
    }
    return !!result?.performed;
  }
  navigateReaderChapter(direction) {
    if(this.readerChapterTask) return Promise.resolve(false);
    const target=this.isLocalSource()?this.localReader:this.webview;
    const task=Promise.resolve().then(()=>target===(this.isLocalSource()?this.localReader:this.webview)?this.changeReaderChapter(direction):false).catch(()=>false);
    this.readerChapterTask=task;
    task.finally(()=>{if(this.readerChapterTask===task)this.readerChapterTask=null;});return task;
  }
  async sendReaderNativeInput(webview,key,modifiers) {
    if(this.unloaded||webview!==this.webview) return false;
    const pass={key,modifiers:modifiers.map(m=>({control:'Ctrl',alt:'Alt',shift:'Shift'})[m]||m),expires:Date.now()+1000,received:false};
    this.readerInputPassThrough=pass;
    try {
      webview.sendInputEvent({type:'keyDown',keyCode:key,modifiers});webview.sendInputEvent({type:'keyUp',keyCode:key,modifiers});
      for(let i=0;i<10&&!pass.received&&webview===this.webview&&!this.unloaded;i++)await new Promise(resolve=>setTimeout(resolve,20));
      return !this.unloaded&&webview===this.webview;
    }finally{if(this.readerInputPassThrough===pass)this.readerInputPassThrough=null;}
  }
  async changeReaderChapter(direction) {
    const webview=this.webview;
    if(this.unloaded||!this.ready||!webview||![-1,1].includes(direction)) return false;
    await this.syncNativeReaderPadding();
    if(this.unloaded||webview!==this.webview) return false;
    const read=()=>webview.executeJavaScript('typeof window.__wrpGetNativeNavigationState === "function" ? window.__wrpGetNativeNavigationState() : null');
    const before=await read();
    if(!before?.supported||!before.ready||!(direction<0?before.previous:before.next)) return false;
    if(!await this.sendReaderNativeInput(webview,direction<0?'F13':'F14',['control','alt','shift'])) return false;
    for(let i=0;i<60&&!this.unloaded&&webview===this.webview;i++) {
      const state=await read();
      if(state?.chapterUid!==before.chapterUid&&state?.ready) return true;
      if(state?.error) return false;
      if(state&&state.sequence>before.sequence&&!state.accepted) return false;
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    return false;
  }
  quickHide() {
    if(!this.visible&&!this.readerLeaf) return false;
    this.hide();return true;
  }
  openReaderCommandHotkeys(command) {
    this.app.setting.open();this.app.setting.openTabById('hotkeys');
    const tab=this.app.setting.settingTabs.find(t=>t.id==='hotkeys');
    tab?.setQuery?.(this.app.commands.commands[this.commandId(command)]?.name||READER_NAVIGATION_COMMANDS[command]?.name||READER_TOGGLE_NAME);
  }
  openReaderToggleHotkeys() {this.openReaderCommandHotkeys('toggle');}
  async resetReaderCommandHotkey(command) {
    if(!COMMAND_HOTKEYS[command]) return false;
    const manager=this.app.hotkeyManager;
    manager.removeHotkeys(this.commandId(command));await manager.save();this.updateShortcutHints();return true;
  }
  async resetReaderToggleHotkey() {return this.resetReaderCommandHotkey('toggle');}
  updateShortcutHints() {
    const label=this.commandHotkeyLabel('toggle').replace(/\s*\+\s*/g,'+'),enabled=this.commandHotkeys('toggle').length>0;
    const hint=enabled?label+' 收起 / 恢复':'收起 / 恢复阅读器';
    for(const button of [this.launchButton,this.status]) if(button) {button.setAttribute('aria-label','微信读书 · '+hint);button.title='微信读书 · '+hint;}
    if(this.pocketCloseButton) {
      const close=enabled?`收起 · ${label} 再打开`:'收起阅读器';
      this.pocketCloseButton.setAttribute('aria-label',close);this.pocketCloseButton.title=close;
    }
    const title=this.isLiteratureEnabled()?(this.settings.literatureTitle.trim()||LITERATURE_DEFAULTS.title):'阅读';
    if(this.message&&this.ready&&!this.appearancePending) this.message.setText(enabled?`${title} · ${label} 收起`:title);
  }
  updateButtons() {
    const automatic = this.automaticPocketEnabled();
    if(!automatic) this.cancelAutoHide();
    if(this.autoButton) {
      this.autoButton.classList.toggle('is-active', automatic);
      this.autoButton.setAttribute('aria-pressed', String(automatic));
      this.autoButton.disabled = false;
      const hide=this.automaticPocketTrigger()==='click'?'移出后点击外部收起':'鼠标移出自动收起';
      const restore=this.settings.dockExpandTrigger==='click'?'点击工具栏展开':'移入工具栏展开';
      const label = this.settings.dockPocket ? `${hide}（${restore}）` : `${hide}（放大时暂停）`;
      this.autoButton.setAttribute('aria-label', label); this.autoButton.title = label;
      setIcon(this.autoButton, this.settings.dockPocket ? (['left','right'].includes(this.pocketToolbarPosition()) ? 'fold-horizontal' : 'fold-vertical') : 'mouse-pointer-2');
      if(this.settings.dockPocket) this.autoButton.setAttribute('aria-expanded', String(!this.dockCollapsed));
      else this.autoButton.removeAttribute('aria-expanded');
    }
    this.panel?.setAttribute('data-wrp-expand-trigger',this.settings.dockExpandTrigger==='click'?'click':'hover');
    if(this.dockButton) {
      this.dockButton.classList.toggle('is-active', !!this.settings.dockPocket);
      this.dockButton.setAttribute('aria-pressed', String(!!this.settings.dockPocket));
      const label = this.settings.dockPocket ? '恢复独立浮动小窗' : '固定小窗到右侧栏底部';
      this.dockButton.setAttribute('aria-label', label); this.dockButton.title = label;
    }
  }
  cancelAutoHide() {
    clearTimeout(this.hideTimer); this.hideTimer = null;
    clearTimeout(this.blurHideTimer); this.blurHideTimer = null;
  }
  automaticPocketEnabled() { return this.settings.dockPocket ? !!this.settings.dockAutoCollapse : !!this.settings.autoHide; }
  automaticPocketTrigger() { return this.settings[this.settings.dockPocket?'dockHideTrigger':'pocketHideTrigger']==='click'?'click':'leave'; }
  setPocketInteraction(field,value) {
    const options=field==='dockExpandTrigger'?['hover','click']:['pocketHideTrigger','dockHideTrigger'].includes(field)?['leave','click']:[];
    if(!options.includes(value)) return false;
    this.cancelAutoHide();this.pocketExpandClickPending=false;
    this.settings[field]=value;this.updateButtons();this.persist();return true;
  }
  closeAutomaticPocket() {
    if(this.settings.dockPocket) this.setPocketDockCollapsed(true);else this.hide();
  }
  handleGuestMouseInput(input) {
    if(!this.visible||this.expanded||this.dockCollapsed||this.unloaded) return;
    if(input.type==='mouseMove'||input.type==='mouseEnter'||input.type==='mouseDown') {
      this.autoHideArmed=true;this.pointerInPocket=true;this.cancelAutoHide();
    } else if(input.type==='mouseLeave') {
      this.autoHideArmed=true;
      this.trackPocketPointer({clientX:NaN,clientY:NaN});
    }
  }
  handlePocketPointerDown(event) {
    if(event.button!==0) return;
    this.pocketExpandClickPending=false;
    if(!this.visible||this.expanded||!this.panel||this.dragging||this.unloaded) return;
    if(this.isPointInPocket(event.clientX,event.clientY)) {
      this.autoHideArmed=true;this.pointerInPocket=true;this.cancelAutoHide();return;
    }
    if(this.automaticPocketEnabled()&&this.automaticPocketTrigger()==='click') this.closeAutomaticPocket();
  }
  isPointInPocket(x, y) {
    if(!this.panel || !this.visible || this.expanded || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const target = this.dockLeaf && this.dockCollapsed ? this.panel.querySelector('.wrp-header') : this.panel;
    const r = (target || this.panel).getBoundingClientRect();
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  }
  isPointerOverPocket() {
    try {
      const remote = require('@electron/remote'), bounds = remote.getCurrentWindow().getContentBounds(), cursor = remote.screen.getCursorScreenPoint();
      // Screen points and window bounds share DIP units; the renderer may zoom.
      if(!bounds.width || !bounds.height || !window.innerWidth || !window.innerHeight) return null;
      return this.isPointInPocket((cursor.x - bounds.x) * window.innerWidth / bounds.width, (cursor.y - bounds.y) * window.innerHeight / bounds.height);
    } catch { return null; }
  }
  trackPocketPointer(event) {
    if(!this.visible || this.expanded || !this.panel || this.dragging) return;
    this.pointerInPocket = this.isPointInPocket(event.clientX, event.clientY);
    if(this.pointerInPocket) {
      this.autoHideArmed = true; this.cancelAutoHide();
      if(this.dockLeaf && this.dockCollapsed && this.settings.dockExpandTrigger!=='click') this.setPocketDockCollapsed(false);
      return;
    }
    if(!this.automaticPocketEnabled() || this.automaticPocketTrigger()!=='leave' || !this.autoHideArmed || this.hideTimer != null || this.dockCollapsed) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if(this.unloaded || !this.automaticPocketEnabled() || this.automaticPocketTrigger()!=='leave' || !this.visible || this.expanded || this.dragging) return;
      const inside = this.isPointerOverPocket();
      if(inside === true || (inside == null && this.pointerInPocket)) return;
      this.closeAutomaticPocket();
    }, 450);
  }
  deferBlurHide() {
    if(!this.automaticPocketEnabled() || !this.visible || this.expanded) return;
    clearTimeout(this.blurHideTimer);
    this.blurHideTimer = setTimeout(() => {
      this.blurHideTimer = null;
      if(this.unloaded || !this.automaticPocketEnabled() || !this.visible || this.expanded || this.dragging) return;
      try {
        // Ignore focus transfer into our guest. Other guests and other windows
        // count as outside interaction, even when the host DOM misses the click.
        if(require('@electron/remote').getCurrentWindow().isFocused()&&this.isPointerOverPocket()!==false) return;
      } catch { if(document.hasFocus() || this.guestFocused) return; }
      this.closeAutomaticPocket();
    }, 150);
  }
  resetPocketBounds() {
    Object.assign(this.settings, { x:null, y:null, width:380, height:280 });
    if(this.panel && !this.expanded && !this.readerLeaf && !this.dockLeaf) this.layout();
    this.persist();
  }
  pocketToolbarPosition() {
    const key=this.settings.dockPocket?'dockToolbarPosition':'pocketToolbarPosition';
    return Object.hasOwn(POCKET_TOOLBAR_POSITIONS,this.settings[key])?this.settings[key]:DEFAULTS[key];
  }
  setPocketToolbarPosition(position) {
    if(!Object.hasOwn(POCKET_TOOLBAR_POSITIONS,position)) return false;
    this.cancelAutoHide();
    if(this.dockCollapsed) this.setPocketDockCollapsed(false);
    this.settings[this.settings.dockPocket?'dockToolbarPosition':'pocketToolbarPosition']=position;
    this.layout(); this.updateButtons(); this.applyPocketDockHeight(); this.persist();
    return true;
  }
  layout() {
    if(!this.panel) return;
    this.panel.setAttribute('data-wrp-toolbar-position',this.pocketToolbarPosition());
    if(this.dockLeaf && !this.expanded) {
      Object.assign(this.panel.style, {left:'auto', top:'auto', width:'100%', height:'100%'});
      this.panel.classList.add('is-docked');
      this.panel.classList.remove('is-expanded');
      this.requestReadingSurfaceLayout();
      return;
    }
    this.panel.classList.remove('is-docked');
    const viewport = {width:window.innerWidth, height:window.innerHeight};
    const rect = this.expanded ? fitRect({width:960,height:760,x:(viewport.width-Math.min(960,viewport.width-24))/2,y:20}, viewport) : fitRect(this.settings, viewport);
    if(!this.expanded) Object.assign(this.settings,rect);
    Object.assign(this.panel.style, {left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
    this.panel.classList.toggle('is-expanded',this.expanded);
    if(this.expandButton) {
      setIcon(this.expandButton,this.expanded?'minimize-2':'maximize-2');
      const label=this.expanded?'缩小回到角落':'放大：登录、目录和原版工具栏';
      this.expandButton.setAttribute('aria-label',label); this.expandButton.title=label;
    }
    this.updateShortcutHints();
    this.requestReadingSurfaceLayout();
  }
  setAppearanceLoadingLabel(label) { this.webview?.parentElement?.setAttribute('data-wrp-loading-label', label); }
  setAppearancePending(pending) {
    if(!this.webview) return;
    if(pending) this.appearanceGeneration = (this.appearanceGeneration || 0) + 1;
    this.appearancePending = !!pending && !!this.settings.hideBottomBar;
    this.webview.classList.toggle('wrp-is-styling', this.appearancePending);
    this.webview.setAttribute('aria-busy', String(this.appearancePending));
    this.webview.parentElement?.classList.toggle('wrp-is-loading', this.appearancePending);
    if(this.appearancePending) this.setAppearanceLoadingLabel('加载中…');
  }
  mountWebview(host) {
    // Electron replaces the guest when a webview or its ancestors move.
    // Keep exactly one connected guest; each view supplies only its bounds.
    if(!this.readingSurface) {
      this.readingSurface = document.body.createDiv({ cls: 'wrp-reading-surface wrp-surface-hidden' });
      if(this.webview) this.readingSurface.appendChild(this.webview);
      this.readingSurface.classList.toggle('wrp-is-loading', this.appearancePending);
      this.surfaceResizeObserver = new ResizeObserver(() => this.requestReadingSurfaceLayout());
      this.registerDomEvent(this.readingSurface, 'pointerenter', () => {
        if(this.expanded) return;
        this.autoHideArmed = true; this.pointerInPocket = true; this.cancelAutoHide();
      });
      this.registerDomEvent(this.readingSurface, 'pointerleave', e => {
        if(this.expanded) return;
        this.autoHideArmed = true; this.trackPocketPointer(e);
      });
    }
    this.surfaceHost = host;
    this.surfaceResizeObserver.disconnect();
    this.surfaceResizeObserver.observe(host);
    const label = host.parentElement?.querySelector('.wrp-reader-title') || this.panel.querySelector('.wrp-title');
    if(label?.id) this.webview?.setAttribute('aria-labelledby', label.id);
    if(this.appearancePending) this.setAppearanceLoadingLabel('加载中…');
    this.syncReadingSurface();
    this.requestReadingSurfaceLayout();
  }
  requestReadingSurfaceLayout() {
    if(this.unloaded || !this.visible || !this.readingSurface || this.surfaceLayoutFrame != null) return;
    this.surfaceLayoutFrame = requestAnimationFrame(() => {
      this.surfaceLayoutFrame = null;
      this.syncReadingSurface();
    });
  }
  syncReadingSurface() {
    const surface = this.readingSurface, host = this.surfaceHost;
    if(!surface) return;
    const rect = host?.isConnected && host.getBoundingClientRect();
    const visible = !this.unloaded && this.visible && rect && rect.width > 0 && rect.height > 0 &&
      rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight &&
      getComputedStyle(host).visibility !== 'hidden';
    // Hidden/inactive views retain the last viewport, preserving scroll and
    // avoiding zero-size repagination. No timer, duplicate page or snapshot.
    surface.classList.toggle('wrp-surface-hidden', !visible);
    if(!visible) return;
    const values = { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px',
      clipPath: `inset(${Math.max(0,-rect.top)}px ${Math.max(0,rect.right-window.innerWidth)}px ${Math.max(0,rect.bottom-window.innerHeight)}px ${Math.max(0,-rect.left)}px)` };
    for(const [key,value] of Object.entries(values)) if(surface.style[key] !== value) surface.style[key] = value;
  }
  navigatePage(url) {
    if(!this.webview || this.unloaded) return;
    try { if(this.webview.getURL() === url) { this.applyAppearance(); return; } } catch {}
    this.ready = false; this.updateFontButtons();
    this.setAppearancePending(true);
    this.webview.src = url;
  }
  reloadPage() {
    if(!this.webview || this.unloaded) return;
    this.ready = false; this.updateFontButtons();
    this.setAppearancePending(true);
    this.webview.reload();
  }
  scheduleAppearanceRetry(revision, navigation, generation) {
    clearTimeout(this.appearanceRetryTimer);
    this.appearanceRetryTimer = setTimeout(() => {
      if(this.unloaded || revision !== this.appearanceRevision || navigation !== this.navigationRevision || generation !== this.appearanceGeneration || !this.appearancePending || !this.ready) return;
      if((this.appearanceRetries || 0) < 2) { this.appearanceRetries = (this.appearanceRetries || 0) + 1; this.applyAppearance(); }
      else { this.setAppearanceLoadingLabel('排版未就绪，请点击刷新'); this.message?.setText('排版未就绪 · 点刷新重试'); }
    }, 1200);
  }
  applyAppearance() {
    this.activateLayoutProfile(); this.updateFontButtons();
    this.updateHostTheme();
    const revision = this.appearanceRevision = (this.appearanceRevision || 0) + 1;
    const navigation = this.navigationRevision;
    clearTimeout(this.appearanceRetryTimer);
    if(!this.settings.hideBottomBar) this.setAppearancePending(false);
    else if(this.styledNavigationRevision !== navigation || this.lastStyledHideBottomBar !== true) this.setAppearancePending(true);
    const generation = this.appearanceGeneration;
    // Navigation, opening a tab and slider changes can arrive together. Keep
    // one tracked stylesheet; apply only the newest queued settings.
    this.appearanceTask = (this.appearanceTask || Promise.resolve()).catch(() => {}).then(async () => {
      if(revision !== this.appearanceRevision || this.unloaded || !this.ready || !this.webview) return;
      if(this.isLiteratureEnabled() && this.settings.readingFlow === 'paged') {
        if(!await this.setReadingFlow('scroll')) return;
        if(revision !== this.appearanceRevision || this.unloaded || !this.ready) return;
      }
      const webview = this.webview;
      try {
        webview.setZoomFactor(this.expanded || this.isLiteratureEnabled() ? 1 : Math.min(1.5, Math.max(0.5, this.settings.zoom)));
        const layoutCss = (this.expanded ? WIDE_CSS : this.settings.compact ? COMPACT_CSS : '') + controlsCss(!this.expanded && this.settings.compact ? 'hidden' : this.settings.controlsPosition, this.contentPadding());
        const themeCss = readerThemeCss(this.readingPalette());
        const css = layoutCss + NATIVE_READER_CSS + themeCss + CHAPTER_NAV_CSS + LITERATURE_CSS + NOTES_PANEL_CSS + (this.expanded ? '' : miniCatalogCss(this.settings.catalogFontSize)) + (this.settings.hideBottomBar ? HIDE_BOTTOM_BAR_CSS : '');
        // One DOM stylesheet follows the current document. Opaque Electron
        // insertion/removal callbacks can be orphaned when the guest moves.
        const updateStyle = (css, epoch, revision, hideBottomBar) => {
          let style = document.getElementById('weread-pocket-appearance');
          if(!style) {
            style = document.createElement('style');
            style.id = 'weread-pocket-appearance';
            (document.head || document.documentElement).appendChild(style);
          }
          // A deadline does not cancel an older guest request. Ignore it if
          // this document has already received a newer instance or revision.
          const savedEpoch = Number(style.dataset.wrpEpoch) || 0;
          const savedRevision = Number(style.dataset.wrpRevision) || 0;
          if(savedEpoch > epoch || (savedEpoch === epoch && savedRevision > revision)) return null;
          style.textContent = css;
          style.dataset.wrpEpoch = String(epoch);
          style.dataset.wrpRevision = String(revision);
          const bars = Array.from(document.querySelectorAll('.wr_page_reader .readerBottomBar'));
          return { epoch, revision, applied: !!style.sheet, bottomHidden: !hideBottomBar || bars.every(bar => getComputedStyle(bar).display === 'none') };
        };
        const update = webview.executeJavaScript(`(${updateStyle.toString()})(${JSON.stringify(css)}, ${this.appearanceEpoch}, ${revision}, ${!!this.settings.hideBottomBar})`);
        const acknowledged = update.then(ack => {
          if(this.unloaded || !this.ready || revision !== this.appearanceRevision || navigation !== this.navigationRevision || generation !== this.appearanceGeneration || webview !== this.webview) return false;
          if(!ack?.applied || !ack.bottomHidden || ack.epoch !== this.appearanceEpoch || ack.revision !== revision) return false;
          this.styledNavigationRevision = navigation;
          this.lastStyledHideBottomBar = this.settings.hideBottomBar;
          this.appearanceRetries = 0;
          clearTimeout(this.appearanceRetryTimer);
          this.setAppearancePending(false);
          return true;
        }).catch(() => false);
        // A timeout keeps the queue moving; it must never expose an unstyled
        // page. A late acknowledgement may still reveal the current document.
        const installed = await Promise.race([acknowledged, new Promise(resolve => setTimeout(() => resolve(false), 250))]);
        if(this.unloaded || revision !== this.appearanceRevision || navigation !== this.navigationRevision || generation !== this.appearanceGeneration) return;
        if(!installed && this.appearancePending) this.scheduleAppearanceRetry(revision, navigation, generation);
        // Reparenting can orphan an Electron guest callback. Native redraw
        // must not hold up stylesheet installation for the next surface.
        await Promise.race([this.refreshReaderLayout(), new Promise(resolve => setTimeout(resolve, 750))]);
        void this.refreshReaderHeader();
      } catch { if(!this.unloaded && this.appearancePending) this.scheduleAppearanceRetry(revision, navigation, generation); }
    });
    return this.appearanceTask;
  }
  async syncNativeReaderPadding() {
    const context = `${this.navigationRevision}:${this.appearanceGeneration}:${this.appearanceRevision}`;
    if(this.nativeLayoutTask && this.nativeLayoutContext === context) return this.nativeLayoutTask;
    let deadline;
    const task = Promise.race([this.resolveNativeReaderPadding(), new Promise(resolve => { deadline = setTimeout(() => resolve(false), 3000); })]);
    this.nativeLayoutTask = task; this.nativeLayoutContext = context;
    try { return await task; } finally {
      clearTimeout(deadline);
      if(this.nativeLayoutTask === task) { this.nativeLayoutTask = null; this.nativeLayoutContext = null; }
    }
  }
  async resolveNativeReaderPadding() {
    if(!this.ready || !this.webview) return false;
    if(this.activateLayoutProfile()) { void this.applyAppearance(); return false; }
    const webview = this.webview;
    const navigation = this.navigationRevision;
    const generation = this.appearanceGeneration;
    const revision = this.appearanceRevision;
    const current = () => !this.unloaded && this.ready && webview === this.webview && navigation === this.navigationRevision && generation === this.appearanceGeneration && revision === this.appearanceRevision;
    const gutter = this.contentPadding();
    const profile = this.layoutProfile();
    const apply = () => webview.executeJavaScript(`(async () => {
      const style = document.getElementById('weread-pocket-appearance');
      if(!style || Number(style.dataset.wrpEpoch) !== ${this.appearanceEpoch} || Number(style.dataset.wrpRevision) !== ${revision}) return false;
      if(!document.querySelector('.readerChapterContent')) return 'unused';
      if(typeof window.__wrpSetLiteratureAppearance === 'function') window.__wrpSetLiteratureAppearance(${JSON.stringify(this.literatureConfig())}, true);
      const applied = typeof window.__wrpApplyNativePadding === 'function' ? window.__wrpApplyNativePadding(${gutter}, ${!this.expanded}, ${this.isPopularUnderlinesEnabled()}, ${profile.fontSizePx}, ${profile.lineHeight}, ${profile.paragraphSpacing}, ${JSON.stringify(this.typographyPreferenceKey())}) : false;
      if(applied && typeof window.__wrpApplyNativeTheme === 'function') await window.__wrpApplyNativeTheme(${JSON.stringify(this.resolvedTheme())});
      return applied;
    })()`);
    try {
      const existing = await apply();
      if(!current()) return false;
      if(existing) return true;
      // Production Vue does not expose its root on DOM elements. Resolve only
      // the native reader's click handler, then keep a document-local bridge.
      const guest = require('@electron/remote').webContents.fromId(webview.getWebContentsId());
      if(!guest || guest.isDestroyed()) return false;
      const alreadyAttached = guest.debugger.isAttached();
      if(alreadyAttached) return false;
      guest.debugger.attach('1.3');
      const group = `wrp-native-layout-${this.appearanceEpoch}-${navigation}-${generation}-${revision}`;
      const command = (method, args) => {
        if(!current()) throw new Error("Reader navigated");
        return guest.debugger.sendCommand(method, args);
      };
      const seen = new Set(); let inspected = 0, found = false;
      const bind = function bindNativeReader() {
  if(!this.$options || !this.$store) return false;
  let reader = this;
  while(reader && reader.$options.name !== 'HorizontalReader' && typeof reader.findObjsWithPoints !== 'function') reader = reader.$parent;
  if(!reader) return false;
  let union = reader;
  while(union && typeof union.handleSwitchMode !== 'function') union = union.$parent;
  const store = this.$store;
  const render = store.state.readerRender;
  const vertical = render ? { canvasTop: render.canvasTop, canvasBottom: render.canvasBottom } : null;
  const legacy = typeof reader.findObjsWithPoints === 'function';
  // WRP_PAGED_INSETS_START
  const nativePagedInsets = function nativePagedInsets(viewport, headers = [], pagers = []) {
    const height = Number(viewport?.height), top = Number(viewport?.top);
    if(!Number.isFinite(height) || height <= 0 || !Number.isFinite(top)) return null;
    const bottom = top + height;
    // Reserve the native 32px pager plus its 24px bottom inset and an 8px gap.
    // Small guests omit the repeated page heading so useful text still fits.
    let canvasTop = height <= 160 ? 12 : 40, canvasBottom = 64;
    const visible = rect => rect && Number(rect.width) > 0 && Number(rect.height) > 0 &&
      Number.isFinite(rect.top) && Number.isFinite(rect.bottom) &&
      rect.top >= top - 1 && rect.bottom <= bottom + 1;
    for(const rect of headers) if(visible(rect)) canvasTop = Math.max(canvasTop, Math.ceil(rect.bottom - top + 8));
    for(const rect of pagers) if(visible(rect)) canvasBottom = Math.max(canvasBottom, Math.ceil(bottom - rect.top + 8));
    return {canvasTop, canvasBottom};
  };
  // WRP_PAGED_INSETS_END

  const cache = new Map(), failures = new Map(), watches = [];
  let layer = null, timer = null, enabled = true, lastDraw = null, disposed = false;
  // Reserve space before native collection: the original canvases, offsets,
  // selection and progress continue to describe the same Chinese text.
  let literature = { enabled:false, english:'', paragraphs:3, fontFamily:'sans-serif' }, literatureStyle = null;
  const originalCollect = legacy && typeof reader.collectPreRenderInfos === 'function' ? reader.collectPreRenderInfos : null;
  // WRP_LITERATURE_LAYOUT_START
  const createLiteratureCards = function createLiteratureCards({ reader, chapterKey, getParagraphSpacing, getConfig, eventDocument = document }) {
  let cards = [], layer = null, key = null, version = null, disposed = false;
  const overrides = new Map();
  const colors = ['#ffd400', '#ff6666', '#5fb236', '#2ea8e5', '#a28ae5'];
  const element = (tag, name, text) => {
    const node = eventDocument.createElement(tag); node.className = name;
    if(text != null) node.textContent = text;
    return node;
  };
  const restore = () => {
    for(const [node, properties] of overrides) for(const [name, saved] of properties) {
      if(saved.value) node.style.setProperty(name, saved.value, saved.priority);
      else node.style.removeProperty(name);
    }
    overrides.clear();
  };
  const reserve = (node, name, value) => {
    if(!overrides.has(node)) overrides.set(node, new Map());
    const properties = overrides.get(node);
    if(!properties.has(name)) properties.set(name, { value:node.style.getPropertyValue(name), priority:node.style.getPropertyPriority(name) });
    node.style.setProperty(name, value, 'important');
  };
  const clear = () => { layer?.remove(); layer = null; cards = []; key = null; version = null; restore(); };
  const quoteStyle = t => `margin:0;padding:0 0 0 8px;border-left:2px solid;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:${t.fontWeight};font-size:${t.fontSize};line-height:${t.lineHeight};font-family:${t.fontFamily};text-align:left;text-justify:none;letter-spacing:normal;word-spacing:0;`;
  const prepare = () => {
    clear();
    const config = getConfig();
    if(disposed || !config.enabled) return;
    const root = reader.$refs.preRenderContainer, content = reader.$refs.preRenderContent;
    if(!root || !content || root.clientWidth < 60) return;
    const paragraphs = [...content.querySelectorAll('p')];
    const english = config.english.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
    if(!paragraphs.length || !english.length) return;
    const width = root.getBoundingClientRect().width;
    const style = getComputedStyle(paragraphs[0]);
    const typography = Object.fromEntries(['fontSize','lineHeight','fontFamily','fontWeight','letterSpacing','wordSpacing'].map(name => [name, style[name]]));
    const size = parseFloat(typography.fontSize) || 12;
    const headerHeight = Math.ceil(size * 1.6) + 12;
    const gap = 12, inset = 8, border = 1;
    const measure = element('div','wrp-literature-measure');
    measure.style.cssText = quoteStyle(typography) + `position:absolute;visibility:hidden;pointer-events:none;left:-100000px;top:0;width:${Math.max(20, width - 2 * (border + inset))}px;`;
    eventDocument.body.appendChild(measure);
    // Shuffle the five accents from the chapter key. Recollection and moving
    // the same chapter between surfaces retain its colors without a cache.
    let colorSeed = 2166136261;
    for(const character of String(chapterKey() ?? '')) colorSeed = Math.imul(colorSeed ^ character.charCodeAt(0), 16777619) >>> 0;
    const colorOrder = colors.slice();
    for(let index = colorOrder.length - 1; index > 0; index--) {
      colorSeed = (Math.imul(colorSeed, 1664525) + 1013904223) >>> 0;
      const swap = colorSeed % (index + 1);
      [colorOrder[index], colorOrder[swap]] = [colorOrder[swap], colorOrder[index]];
    }
    const heights = new Map(), groups = [];
    try {
      // The native collector reads these insets before drawing the original
      // Chinese canvases. Text offsets and selection remain native.
      for(const p of paragraphs) {
        reserve(p,'padding-left',`${border + inset}px`);
        reserve(p,'padding-right',`${border + inset}px`);
        reserve(p,'box-sizing','border-box');
      }
      for(let start = 0; start < paragraphs.length; start += config.paragraphs) {
        const group = paragraphs.slice(start, start + config.paragraphs), quote = english[groups.length % english.length];
        if(!heights.has(quote)) { measure.textContent = quote; heights.set(quote, Math.ceil(measure.getBoundingClientRect().height)); }
        const quoteHeight = heights.get(quote), quoteTop = headerHeight + 4;
        const bodyTop = border + quoteTop + quoteHeight + 9;
        reserve(group[0],'padding-top',`${bodyTop}px`);
        reserve(group.at(-1),'padding-bottom',`${getParagraphSpacing() + 4 + border + gap}px`);
        groups.push({ group, color:colorOrder[groups.length % colorOrder.length], english:quote, typography, headerHeight, quoteTop, quoteHeight });
      }
      const origin = root.getBoundingClientRect();
      cards = groups.map(({group, ...card}) => {
        const first = group[0].getBoundingClientRect(), last = group.at(-1).getBoundingClientRect();
        return { ...card, x:0, y:first.top - origin.top, width, height:last.bottom - first.top - gap };
      });
    } finally { measure.remove(); }
  };
  const draw = () => {
    const target = reader.$refs.renderTargetContainer;
    if(disposed || reader._isDestroyed || !getConfig().enabled || !cards.length || key !== chapterKey() || version !== reader.renderContentsVersion || reader.chapterContentState !== 'DONE') { layer?.remove(); layer = null; return; }
    if(!target?.isConnected || (layer?.parentElement === target && layer.dataset.wrpVersion === String(version))) return;
    const next = element('div','wrp-literature-cards');
    next.dataset.wrpVersion = String(version);
    // Canvas chunks are opaque at z-index 2. Transparent decorations must be
    // above them; otherwise borders disappear in the middle of a card.
    next.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;color:var(--wrp-text-normal);';
    layer?.remove(); target.appendChild(next); layer = next;
    for(const [index, card] of cards.entries()) {
      const color = card.color, box = element('section','wrp-literature-card');
      box.style.cssText = `position:absolute;box-sizing:border-box;border:1px solid var(--wrp-border);border-radius:4px;left:0;right:0;top:${card.y}px;height:${card.height}px;background:transparent;`;
      next.appendChild(box);
      // Zoom can quantize a 1px border to a fractional CSS width. Match the
      // native paragraph's 9px edge using the painted border, not a guess.
      const paintedBorder=parseFloat(getComputedStyle(box).borderLeftWidth)||1;
      const quoteInset=Math.max(0,9-paintedBorder);
      const header = element('div','wrp-literature-card-header');
      const ui = `font-family:${card.typography.fontFamily};font-size:${card.typography.fontSize};font-weight:400;line-height:1.4;`;
      header.style.cssText = `position:absolute;left:0;right:0;top:0;height:${card.headerHeight}px;display:flex;align-items:center;gap:8px;padding:0 8px;border-bottom:1px solid var(--wrp-border);box-sizing:border-box;${ui}color:var(--wrp-text-muted);`;
      const icon = element('span','wrp-literature-icon','☷'); icon.style.color = color;
      const page = element('span','wrp-literature-page',`第${index + 1}页 ↗`);
      const more = element('span','wrp-literature-more','⋯'); more.style.marginLeft = 'auto';
      header.appendChild(icon); header.appendChild(page); header.appendChild(more);
      const quote = element('div','wrp-literature-english',card.english);
      quote.style.cssText = quoteStyle(card.typography) + `position:absolute;left:${quoteInset}px;right:${quoteInset}px;top:${card.quoteTop}px;border-color:${color};`;
      const divider = element('div','wrp-literature-body-divider');
      divider.style.cssText = `position:absolute;left:0;right:0;top:${card.quoteTop + card.quoteHeight + 4}px;border-top:1px solid var(--wrp-border);`;
      box.appendChild(header); box.appendChild(quote); box.appendChild(divider);
    }
  };
  return {
    prepare, draw, clear,
    collected(chapter, renderVersion) { if(disposed || chapter !== chapterKey()) return; key = chapter; version = renderVersion; draw(); },
    dispose() { disposed = true; clear(); }
  };
};
  // WRP_LITERATURE_LAYOUT_END
  const cardLayout = legacy ? createLiteratureCards({reader,chapterKey:()=>chapterKey(),getParagraphSpacing:()=>paragraphSpacing,getConfig:()=>literature}) : null;
  const collectWithCards = originalCollect && function() {
    cardLayout?.prepare();
    const key = chapterKey();
    return Promise.resolve(originalCollect.apply(this,arguments)).then(result=>{
      if(!disposed) cardLayout?.collected(key,reader.renderContentsVersion);
      return result;
    });
  };
  if(collectWithCards) reader.collectPreRenderInfos = collectWithCards;
  const rangeOf = value => {
    if(typeof value === 'string') {
      const match = /^(\d+)-(\d+)$/.exec(value);
      return match ? { start: Number(match[1]), end: Number(match[2]) + 1 } : null;
    }
    if(value && Number.isFinite(value.start) && Number.isFinite(value.end)) return { start: value.start, end: value.end };
    return null;
  };
  const subtract = (range, own) => {
    let pieces = [range];
    for(const note of own) pieces = pieces.flatMap(piece => {
      if(note.end <= piece.start || note.start >= piece.end) return [piece];
      const result = [];
      if(note.start > piece.start) result.push({ start: piece.start, end: note.start });
      if(note.end < piece.end) result.push({ start: note.end, end: piece.end });
      return result;
    });
    return pieces;
  };
  const chapterKey = () => reader.bookId && reader.currentChapter?.chapterUid != null ? `${reader.bookId}:${reader.currentChapter.chapterUid}` : null;
  // WRP_UNDERLINE_INTERACTION_START
  const createUnderlineInteraction = function createNativeUnderlineInteraction({ reader, store, chapterKey, isEnabled, requestReviews = null, eventDocument = document, environment = window }) {
  let disposed = false, marks = [], marksChapter = null, marksVersion = null, gesture = null, revision = 0, requestSerial = 0, cache = null;
  let notesPanel = null, notesRoot = null, restoreNotesHide = null;
  const stopScrollPropagation = event => {
    if(typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    else event.stopPropagation?.();
  };
  const notesWheel = event => {
    if(!notesPanel || event.ctrlKey || !event.deltaY) return;
    stopScrollPropagation(event);
    // Inside the list, preserve native scrolling, including a long individual
    // note. Outside it, never send the gesture through to the book.
    if(!notesPanel.contains(event.target)) event.preventDefault();
  };
  const notesKey = event => {
    if(!notesPanel || event.ctrlKey || event.metaKey || event.altKey || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const keys = ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Spacebar'];
    if(!keys.includes(event.key)) return;
    event.preventDefault(); stopScrollPropagation(event);
    const line = parseFloat(environment.getComputedStyle?.(notesPanel.querySelector('.readerReviewDetail_item > .content') || notesPanel)?.lineHeight) || 22.4;
    const page = Math.max(line, notesPanel.clientHeight * .8), extent = Math.max(0, notesPanel.scrollHeight - notesPanel.clientHeight);
    const delta = event.key === 'ArrowUp' ? -line : event.key === 'ArrowDown' ? line : event.key === 'PageUp' || ([' ','Spacebar'].includes(event.key) && event.shiftKey) ? -page : page;
    notesPanel.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? extent : Math.max(0, Math.min(extent, notesPanel.scrollTop + delta));
  };
  const releaseNotesScroll = () => {
    eventDocument.removeEventListener('wheel', notesWheel, true);
    eventDocument.removeEventListener('keydown', notesKey, true);
    notesPanel?.classList?.remove('wrp-notes-scroll-active');
    notesRoot?.classList?.remove('wrp-notes-open');
    notesPanel = null; notesRoot = null;
    const restore = restoreNotesHide; restoreNotesHide = null; restore?.();
  };
  const lockNotesScroll = panel => {
    notesPanel = panel;
    notesRoot = eventDocument.documentElement || eventDocument.scrollingElement;
    notesRoot?.classList?.add('wrp-notes-open');
    panel.classList?.add('wrp-notes-scroll-active');
    eventDocument.addEventListener('wheel', notesWheel, {capture:true,passive:false});
    eventDocument.addEventListener('keydown', notesKey, true);
  };
  const active = (key, version, token, refreshedRange = null) => !disposed && isEnabled() && chapterKey() === key && (reader.renderContentsVersion === version || (refreshedRange && marksChapter === key && marksVersion === reader.renderContentsVersion && marks.some(mark => mark.range.start === refreshedRange.start && mark.range.end === refreshedRange.end))) && reader.chapterContentState === 'DONE' && revision === token && !reader._isDestroyed;
  const rangeValue = range => range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start ? { start:range.start, end:range.end } : null;
  const message = text => { if(typeof reader.$toast === 'function') reader.$toast(text, 1800); };
  const fetchReviews = requestReviews || (async ({ bookId, chapterUid, range }, signal) => {
    const payload = { bookId, chapterUid, reviews:[{ range, maxIdx:0, count:30, synckey:0 }] };
    if(store._actions?.ACTION_SYNC_BOOK_UNDERLINE_REVIEWS) return store.dispatch('ACTION_SYNC_BOOK_UNDERLINE_REVIEWS', { bookId, chapterUid, range, maxIdx:0, count:30, synckey:0 });
    if(typeof environment.__WRPA__?.sr !== 'function') throw new Error('Native request signature unavailable');
    const signature = await environment.__WRPA__.sr({ body:payload });
    if(signal?.aborted) throw new Error('Request cancelled');
    const response = await environment.fetch('/web/book/readReviews', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json', 'x-wrpa-0':signature }, body:JSON.stringify(payload), signal });
    if(!response.ok) throw new Error('Reading notes unavailable');
    const data = await response.json();
    if(data.errCode) throw new Error('Reading notes unavailable');
    const result = data.reviews?.[0];
    if(!result || !Array.isArray(result.pageReviews)) throw new Error('Invalid reading notes response');
    return result;
  });
  const load = (key, range) => {
    const requestKey = key + ':' + range.start + '-' + range.end;
    if(cache?.key === requestKey) return cache.task;
    cache?.controller.abort();
    const controller = new environment.AbortController();
    const entry = { key:requestKey, controller, task:null };
    let timeout;
    const deadline = new Promise((resolve, reject) => { timeout = environment.setTimeout(() => { controller.abort(); reject(new Error('Reading notes timeout')); }, 8000); });
    const request = Promise.resolve().then(() => fetchReviews({ bookId:reader.bookId, chapterUid:reader.currentChapter.chapterUid, range:range.start + '-' + (range.end - 1) }, controller.signal));
    entry.task = Promise.race([request, deadline]).finally(() => environment.clearTimeout(timeout));
    cache = entry;
    entry.task.catch(() => { if(cache === entry) cache = null; });
    return entry.task;
  };
  const openRange = async value => {
    const range = rangeValue(value), key = chapterKey(), version = reader.renderContentsVersion, token = revision;
    if(!range || !key || !active(key, version, token)) return false;
    const serial = ++requestSerial;
    try {
      const result = await load(key, range);
      if(serial !== requestSerial || !active(key, version, token, range)) return false;
      const reviews = Array.isArray(result?.pageReviews) ? result.pageReviews : [];
      if(!reviews.length) { message('这处划线暂无公开想法'); return true; }
      // Reuse the native pure converter without writing the user's note store.
      const convert = store._modules?.root?._children?.bookReview?._rawModule?.getters?.notes;
      if(typeof convert !== 'function' || typeof reader.showReviewDetailPanel !== 'function') throw new Error('Native notes panel unavailable');
      const state = { ...store.state.bookReview, bookmarks:{ bookmarkList:[], isFetching:false }, noteReviews:{ reviewList:reviews, isFetching:false } };
      const notes = convert(state)?.noteList?.filter(note => note.range && Number.isFinite(note.range.start) && Number.isFinite(note.range.end));
      if(!notes?.length) throw new Error('Native notes conversion unavailable');
      if(serial !== requestSerial || !active(key, version, token, range)) return false;
      releaseNotesScroll();
      reader.showReviewDetailPanel(notes);
      // The official personal-note panel renders Delete for every item. Public
      // thoughts use its original presentation with no mutation callback.
      if(typeof reader.$showReviewDetailPanel === 'function' && reader.$refs?.appContent) {
        reader.$showReviewDetailPanel({parentNode:reader.$refs.appContent,reviewNotes:notes,onHide:()=>{releaseNotesScroll();reader.clearHighLight?.();},onClickItem:null});
      } else {
        const detail = Object.values(reader.$refs || {}).find(ref => ref?.$options?.name === 'ReaderReviewDetailPanel');
        if(detail) {
          detail.onClickItem = null;
          const originalHide = detail.onHide;
          const hide = (...args) => {releaseNotesScroll();originalHide?.apply(detail,args);};
          detail.onHide = hide;
          restoreNotesHide = () => {if(detail.onHide === hide) detail.onHide = originalHide;};
        }
      }
      if(typeof reader.$nextTick==='function') await reader.$nextTick();
      if(active(key,version,token,range) && serial===requestSerial) {
        const panel=eventDocument.querySelector?.('.readerReviewDetailPanel_bg');
        if(panel) lockNotesScroll(panel);
        for(const actions of panel?.querySelectorAll('.readerReviewDetail_item > .actions') || []) actions.remove();
        if(panel && !panel.querySelector('.wrp-notes-close') && typeof reader.hideReviewDetailPanel==='function') {
          const close=eventDocument.createElement('button');
          close.className='wrp-notes-close';close.textContent='×';close.type='button';
          close.setAttribute('aria-label','关闭笔记');close.title='关闭笔记';
          close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();reader.hideReviewDetailPanel();});
          panel.prepend(close);
        }
      }
      return true;
    } catch {
      if(serial === requestSerial && active(key, version, token, range)) message('想法暂时无法加载，请稍后再试');
      return false;
    }
  };
  const down = event => { gesture = event.button === 0 ? { x:event.clientX, y:event.clientY, dragged:false } : null; };
  const move = event => { if(gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) gesture.dragged = true; };
  const cancel = () => { gesture = null; };
  const click = event => {
    const start = gesture; gesture = null;
    if(!start || start.dragged || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    if(!active(marksChapter, marksVersion, revision) || !reader.$refs.renderTargetContainer?.contains(event.target)) return;
    const hit = marks.find(mark => {
      if(!mark.element.isConnected) return false;
      const rect = mark.element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom + 2;
    });
    if(!hit) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void openRange(hit.range);
  };
  eventDocument.addEventListener('mousedown', down, true);
  eventDocument.addEventListener('mousemove', move, true);
  eventDocument.addEventListener('click', click, true);
  eventDocument.addEventListener('pointercancel', cancel, true);
  const clear = () => { releaseNotesScroll(); marks = []; marksChapter = null; marksVersion = null; gesture = null; revision++; requestSerial++; };
  return {
    openRange,
    setMarks(entries, key, version) { if(key !== marksChapter) clear(); marks = entries.filter(mark => mark?.element && rangeValue(mark.range)); marksChapter = key; marksVersion = version; },
    clear,
    dispose() {
      if(disposed) return;
      disposed = true; clear(); cache?.controller.abort(); cache = null;
      eventDocument.removeEventListener('mousedown', down, true);
      eventDocument.removeEventListener('mousemove', move, true);
      eventDocument.removeEventListener('click', click, true);
      eventDocument.removeEventListener('pointercancel', cancel, true);
    }
  };
};
  // WRP_UNDERLINE_INTERACTION_END
  const underlineInteraction = legacy ? createUnderlineInteraction({reader,store,chapterKey,isEnabled:()=>enabled&&!disposed}) : null;
  const schedule = () => {
    clearTimeout(timer);
    if(!disposed) timer = setTimeout(() => { draw().catch(() => {}); }, 60);
  };
  const metadata = async (key, bookId, chapterUid) => {
    if(cache.has(key)) return cache.get(key);
    if(Date.now() - (failures.get(key) || 0) < 15000) return null;
    const task = fetch(`/web/book/underlines?bookId=${encodeURIComponent(bookId)}&chapterUid=${encodeURIComponent(chapterUid)}`, { credentials: 'same-origin' })
      .then(async response => {
        if(!response.ok) throw new Error('Underline metadata unavailable');
        const data = await response.json();
        if(!Array.isArray(data.underlines)) throw new Error('Invalid underline metadata');
        return data.underlines;
      }).catch(() => { cache.delete(key); failures.set(key, Date.now()); return null; });
    cache.set(key, task);
    while(cache.size > 20) cache.delete(cache.keys().next().value);
    return task;
  };
  const draw = async () => {
    if(disposed || reader._isDestroyed || !legacy) return;
    cardLayout?.draw();
    if(!enabled) { layer?.remove(); layer = null; lastDraw = null; underlineInteraction?.clear(); return; }
    if(typeof reader.chapterContentState === 'string' && reader.chapterContentState !== 'DONE') return;
    const target = reader.$refs.renderTargetContainer;
    const key = chapterKey();
    if(!target || !key || !target.isConnected) return;
    const version = reader.renderContentsVersion;
    if(lastDraw === `${key}:${version}` && layer?.parentElement === target) return;
    // Clear a previous chapter immediately, without moving or replacing text.
    if(layer?.dataset.wrpChapter !== key) { layer?.remove(); layer = null; underlineInteraction?.clear(); }
    const marks = await metadata(key, reader.bookId, reader.currentChapter.chapterUid);
    if(!marks || disposed || !enabled || reader._isDestroyed || key !== chapterKey()) return;
    if(typeof reader.chapterContentState === 'string' && reader.chapterContentState !== 'DONE') return;
    if(target !== reader.$refs.renderTargetContainer || !target.isConnected) { schedule(); return; }
    if(version !== reader.renderContentsVersion) { schedule(); return; }
    const objects = reader.findObjsWithPoints({ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e9 });
    if(!objects.length) return;
    const own = (reader.notesListInCurrentChapter || []).map(note => rangeOf(note.range)).filter(Boolean);
    const next = document.createElement('div');
    next.className = 'wrp-popular-underlines';
    next.dataset.wrpChapter = key;
    next.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
    let ranges = 0;
    const clickableMarks = [];
    for(const mark of marks) {
      const range = rangeOf(mark.range);
      if(!range || range.end <= range.start) continue;
      let drew = false;
      for(const piece of subtract(range, own)) {
        const selected = reader.findObjsInOffsetRange(objects, piece.start, piece.end);
        for(const rect of reader.getRectsByContentObjs(selected)) {
          if(![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) continue;
          const line = document.createElement('div');
          line.className = 'wrp-popular-underline';
          line.style.cssText = `position:absolute;pointer-events:none;box-sizing:content-box;border-bottom:1px dashed #8c8c8e;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;`;
          next.appendChild(line);
          clickableMarks.push({element:line,range});
          drew = true;
        }
      }
      if(drew) ranges++;
    }
    next.dataset.wrpRanges = String(ranges);
    next.dataset.wrpMarks = String(marks.length);
    next.dataset.wrpRenderVersion = String(version);
    layer?.remove();
    target.appendChild(next);
    layer = next;
    underlineInteraction?.setMarks(clickableMarks,key,version);
    lastDraw = `${key}:${version}`;
  };
  const cleanup = () => {
    disposed = true;
    document.removeEventListener('keydown',nativeNavigationKey,true);
    if(window.__wrpGetNativeNavigationState===nativeNavigationState)delete window.__wrpGetNativeNavigationState;
    clearTimeout(timer);
    for(const stop of watches) stop();
    layer?.remove(); layer = null;
    underlineInteraction?.dispose();
    fontStyle?.remove(); fontStyle = null;
    lineStyle?.remove(); lineStyle = null;
    paragraphStyle?.remove(); paragraphStyle = null;
    cardLayout?.dispose();
    literatureStyle?.remove(); literatureStyle = null;
    document.body.classList.remove('wrp-literature-mode');
    if(collectWithCards && reader.collectPreRenderInfos === collectWithCards) reader.collectPreRenderInfos = originalCollect;
  };
  if(legacy) {
    watches.push(reader.$watch(() => reader.renderContentsVersion, schedule));
    watches.push(reader.$watch(() => reader.chapterContentState, schedule));
    watches.push(reader.$watch(() => chapterKey(), schedule));
    watches.push(reader.$watch(() => reader.notesListInCurrentChapter, () => { lastDraw = null; schedule(); }, { deep: true }));

  }
  let navigationSequence=0, navigationAccepted=false, navigationPending=false, navigationResult=null, navigationError=null;
  const nativeNavigationState=()=>{
    if(disposed||reader._isDestroyed) return null;
    const supported=typeof reader.handlePrevChapter==='function'&&typeof reader.handleNextChapter==='function'&&typeof reader.getChapterWithIdxOffset==='function';
    const ready=reader.currentChapter?.chapterUid!=null&&(reader.chapterContentState==null||reader.chapterContentState==='DONE');
    let previous=false,next=false;
    if(supported&&ready) {try {previous=!!reader.getChapterWithIdxOffset(-1);next=!!reader.getChapterWithIdxOffset(1);} catch (_) {}}
    return {supported,ready,previous,next,chapterUid:reader.currentChapter?.chapterUid,sequence:navigationSequence,accepted:navigationAccepted,pending:navigationPending,result:navigationResult,error:navigationError};
  };
  const nativeNavigationKey=event=>{
    if(!event.isTrusted||!event.ctrlKey||!event.altKey||!event.shiftKey||event.metaKey||!['F13','F14'].includes(event.key)) return;
    const state=nativeNavigationState();
    if(!state?.supported||!state.ready) return;
    event.preventDefault();event.stopImmediatePropagation();navigationSequence++;navigationAccepted=false;navigationPending=false;navigationResult=null;navigationError=null;
    const direction=event.key==='F13'?-1:1;
    if(!(direction<0?state.previous:state.next)) return;
    // The native handler receives the original trusted keyboard event. Its
    // access checks, chapter loading and progress updates remain in charge.
    try {
      const result=reader[direction<0?'handlePrevChapter':'handleNextChapter'](event);
      navigationAccepted=true;
      if(result&&typeof result.then==='function') {
        const sequence=navigationSequence;
        navigationPending=true;
        Promise.resolve(result).then(value=>{if(sequence===navigationSequence){navigationResult=value==null?null:{success:value.success??null,reason:value.reason??null};navigationPending=false;}},error=>{if(sequence===navigationSequence){navigationError=String(error?.message||error);navigationPending=false;}});
      }
    } catch (error) { navigationError=String(error?.message||error); }
  };
  window.__wrpGetNativeNavigationState=nativeNavigationState;
  document.addEventListener('keydown',nativeNavigationKey,true);
  const nativeFontSizes = [18, 21, 24, 28, 32, 36, 42];
  const smallFontSizes = [10, 12, 14, 16];
  let fontStyle = null, lineStyle = null, paragraphStyle = null, lineHeight = 1.9, paragraphSpacing = 0;
  let restoreFontPx = null, restoreLineHeight = null, fontPreferenceSeen = false, linePreferenceSeen = false;
  let restoreParagraphSpacing = null, paragraphPreferenceSeen = false, preferenceKey = null;
  let contentWidth = null, pendingReflow = false;
  const validLineHeight = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 3;
  const validParagraphSpacing = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 80;
  const fontState = () => {
    if(disposed || reader._isDestroyed || typeof reader.changeFontSize !== 'function') return null;
    const level = Number(reader.fontSizeLevel);
    const custom = Number(fontStyle?.dataset.wrpFontSize);
    return { level, size: level === 1 && smallFontSizes.includes(custom) ? custom : nativeFontSizes[level - 1], lineHeight, paragraphSpacing, preferenceKey, count: nativeFontSizes.length, ready: reader.chapterContentState === 'DONE' };
  };
  const applyFontOverride = size => {
    if(!smallFontSizes.includes(size)) { fontStyle?.remove(); fontStyle = null; return; }
    if(!fontStyle) {
      fontStyle = document.createElement('style');
      fontStyle.id = 'weread-pocket-font-size';
      (document.head || document.documentElement).appendChild(fontStyle);
    }
    fontStyle.dataset.wrpFontSize = String(size);
    // Native collection reads these computed fonts before drawing canvases.
    // Recollect even at the same native level so underline geometry follows.
    fontStyle.textContent = '.wr_page_reader .readerChapterContent.fontLevel1{font-size:' + size + 'px!important}.wr_page_reader .readerChapterContent.fontLevel1 .preRenderContainer .preRenderContent p,.wr_page_reader .readerChapterContent.fontLevel1 .renderTargetContent p{font-size:' + size + 'px!important;line-height:' + (Math.round(size * lineHeight * 1000) / 1000) + 'px!important}';
  };
  const applyLineHeight = value => {
    lineHeight = value;
    if(!lineStyle) {
      lineStyle = document.createElement('style');
      lineStyle.id = 'weread-pocket-line-height';
      (document.head || document.documentElement).appendChild(lineStyle);
    }
    lineStyle.dataset.wrpLineHeight = String(value);
    lineStyle.textContent = '.wr_page_reader .readerChapterContent[class*="fontLevel"] .preRenderContainer .preRenderContent p,.wr_page_reader .readerChapterContent[class*="fontLevel"] .renderTargetContent p{line-height:' + value + '!important}';
  };
  window.__wrpGetFontState = fontState;
  const applyParagraphSpacing = value => {
    paragraphSpacing = value;
    if(!paragraphStyle) {
      paragraphStyle = document.createElement('style'); paragraphStyle.id = 'weread-pocket-paragraph-spacing';
      (document.head || document.documentElement).appendChild(paragraphStyle);
    }
    paragraphStyle.dataset.wrpParagraphSpacing = String(value);
    // Replace native paragraph spacing before collecting canvas geometry.
    // Keep all vertical spacing in padding so it cannot collapse with margins.
    paragraphStyle.textContent = '.wr_page_reader .readerChapterContent[class*="fontLevel"] .preRenderContainer .preRenderContent p,.wr_page_reader .readerChapterContent[class*="fontLevel"] .renderTargetContent p{margin-top:0!important;margin-bottom:0!important;padding-top:0!important;padding-bottom:' + value + 'px!important}';
  };
  const setTypography = async (size, spacing, force = false, paragraphs = null) => {
    const before = fontState();
    if(!before?.ready || ![...smallFontSizes, ...nativeFontSizes].includes(size) || (spacing != null && !validLineHeight(spacing)) || (paragraphs != null && !validParagraphSpacing(paragraphs))) return false;
    const level = smallFontSizes.includes(size) ? 1 : nativeFontSizes.indexOf(size) + 1;
    if(!force && before.size === size && before.level === level && (spacing == null || (spacing === lineHeight && lineStyle)) && (paragraphs == null || (paragraphs === paragraphSpacing && paragraphStyle))) return true;
    const previousOverride = Number(fontStyle?.dataset.wrpFontSize);
    const previousLineHeight = lineHeight, previousLineApplied = !!lineStyle;
    const previousParagraphSpacing = paragraphSpacing, previousParagraphApplied = !!paragraphStyle;
    if(spacing != null) applyLineHeight(spacing);
    if(paragraphs != null) applyParagraphSpacing(paragraphs);
    applyFontOverride(size);
    layer?.remove(); layer = null; lastDraw = null;
    underlineInteraction?.clear();
    try { await Promise.resolve(reader.changeFontSize(level)); }
    catch {
      if(disposed || reader._isDestroyed) return false;
      lineHeight = previousLineHeight;
      if(previousLineApplied) applyLineHeight(previousLineHeight);
      else { lineStyle?.remove(); lineStyle = null; }
      paragraphSpacing = previousParagraphSpacing;
      if(previousParagraphApplied) applyParagraphSpacing(previousParagraphSpacing);
      else { paragraphStyle?.remove(); paragraphStyle = null; }
      applyFontOverride(previousOverride);
      try { await Promise.resolve(reader.changeFontSize(before.level)); } catch { /* Keep the last font preference for recovery. */ }
      return false;
    }
    return !disposed && !reader._isDestroyed;
  };
  window.__wrpSetFontSize = size => {
    const before = fontState();
    if(!before?.ready || ![...smallFontSizes, ...nativeFontSizes].includes(size)) return Promise.resolve(false);
    fontPreferenceSeen = true; restoreFontPx = null;
    return setTypography(size, null);
  };
  window.__wrpSetLineHeight = value => {
    const before = fontState();
    if(!before?.ready || !validLineHeight(value)) return Promise.resolve(false);
    linePreferenceSeen = true; restoreLineHeight = null;
    return setTypography(before.size, value);
  };
  window.__wrpSetParagraphSpacing = value => {
    const before = fontState();
    if(!before?.ready || !validParagraphSpacing(value)) return Promise.resolve(false);
    paragraphPreferenceSeen = true; restoreParagraphSpacing = null;
    return setTypography(before.size, null, false, value);
  };
  const restoreTypography = () => {
    if((restoreFontPx == null && restoreLineHeight == null && restoreParagraphSpacing == null && !pendingReflow) || reader.chapterContentState !== 'DONE' || disposed) return;
    const size = restoreFontPx ?? fontState()?.size, spacing = restoreLineHeight, force = pendingReflow, paragraphs = restoreParagraphSpacing;
    restoreFontPx = null; restoreLineHeight = null; restoreParagraphSpacing = null; pendingReflow = false;
    const requestedKey = preferenceKey;
    setTypography(size, spacing, force, paragraphs).then(ok => {
      if(!ok && requestedKey != null && preferenceKey === requestedKey && !disposed) preferenceKey = null;
    }).catch(() => {});
  };
  window.__wrpSetLiteratureAppearance = (config, deferReflow = false) => {
    if(disposed || reader._isDestroyed) return false;
    if(!originalCollect) return !config?.enabled;
    const candidate=config?.dockBounds;
    const dockBounds=Number.isFinite(candidate?.left)&&Number.isFinite(candidate?.right)&&candidate.left>=0&&candidate.right-candidate.left>=80&&candidate.right<=window.innerWidth ? {left:candidate.left,right:candidate.right} : null;
    const next = { enabled: !!config?.enabled, english: String(config?.english || '').slice(0, 12000).replace(/\r\n?/g, '\n'), paragraphs: Math.max(1, Math.min(6, Math.round(Number(config?.paragraphs) || 3))), fontFamily:String(config?.fontFamily || 'sans-serif').replace(/[{};\r\n<>]/g,'').slice(0,500),dockBounds };
    if(JSON.stringify(next) === JSON.stringify(literature)) return true;
    const needsReflow = literature.enabled || next.enabled;
    literature = next;
    cardLayout?.clear();
    if(next.enabled) {
      if(!literatureStyle) { literatureStyle=document.createElement('style');literatureStyle.id='weread-pocket-literature-typography';(document.head||document.documentElement).appendChild(literatureStyle); }
      literatureStyle.textContent='.wr_page_reader.wrp-literature-mode .preRenderContent p,.wr_page_reader.wrp-literature-mode .renderTargetContent p{font-family:'+next.fontFamily+'!important;font-weight:400!important;text-indent:0!important;text-align:left!important;letter-spacing:normal!important;word-spacing:normal!important}.wr_page_reader.wrp-literature-mode .preRenderContent p *,.wr_page_reader.wrp-literature-mode .renderTargetContent p *{font-family:inherit!important}';
      if(next.dockBounds) literatureStyle.textContent+='.wr_page_reader.wrp-literature-mode .readerChapterContent{padding-left:'+next.dockBounds.left+'px!important;padding-right:max(0px,calc(100% - '+next.dockBounds.right+'px))!important}';
    } else { literatureStyle?.remove();literatureStyle=null; }
    document.body.classList.toggle('wrp-literature-mode', literature.enabled);
    if(needsReflow) { pendingReflow = true; if(!deferReflow) restoreTypography(); }
    return true;
  };
  if(typeof reader.changeFontSize === 'function') watches.push(reader.$watch(() => reader.chapterContentState, restoreTypography));
  reader.$once('hook:beforeDestroy', cleanup);
  let desiredTheme = null;
  window.__wrpApplyNativeTheme = async theme => {
    if(disposed || reader._isDestroyed || !['dark', 'light'].includes(theme) || !store._actions?.toggleTheme) return false;
    desiredTheme = theme;
    const isWhite = theme === 'light';
    if(store.state.isWhiteTheme !== isWhite) await store.dispatch('toggleTheme', { isWhite, modifyCookie: false });
    await reader.$nextTick();
    return !disposed && !reader._isDestroyed && store.state.isWhiteTheme === isWhite && document.body.classList.contains('wr_whiteTheme') === isWhite;
  };
  if(store._actions?.toggleTheme) watches.push(reader.$watch(() => reader.isWhiteTheme, () => {
    if(desiredTheme && !disposed && store.state.isWhiteTheme !== (desiredTheme === 'light')) window.__wrpApplyNativeTheme(desiredTheme).catch(() => {});
  }));
  window.__wrpSetReadingFlow = flow => {
    if(reader._isDestroyed || !union || typeof union.handleSwitchMode !== 'function') return false;
    const horizontal = !!document.querySelector('.wr_horizontalReader');
    if(horizontal !== (flow === 'paged')) union.handleSwitchMode(flow === 'paged');
    return true;
  };
  window.__wrpApplyNativePadding = (value, pocket, showPopular, preferredFontPx, preferredLineHeight, preferredParagraphSpacing, profileKey) => {
    if(reader._isDestroyed || disposed) return false;
    if(typeof profileKey === 'string' && profileKey !== preferenceKey) {
      preferenceKey = profileKey;
      fontPreferenceSeen = true; linePreferenceSeen = true; paragraphPreferenceSeen = true;
      restoreFontPx = [...smallFontSizes, ...nativeFontSizes].includes(preferredFontPx) ? preferredFontPx : null;
      restoreLineHeight = validLineHeight(preferredLineHeight) ? preferredLineHeight : null;
      restoreParagraphSpacing = validParagraphSpacing(preferredParagraphSpacing) ? preferredParagraphSpacing : null;
    }
    if(!fontPreferenceSeen) {
      fontPreferenceSeen = true;
      if(smallFontSizes.includes(preferredFontPx)) restoreFontPx = preferredFontPx;
    }
    if(!linePreferenceSeen && validLineHeight(preferredLineHeight)) { linePreferenceSeen = true; restoreLineHeight = preferredLineHeight; }
    if(!paragraphPreferenceSeen && validParagraphSpacing(preferredParagraphSpacing)) { paragraphPreferenceSeen = true; restoreParagraphSpacing = preferredParagraphSpacing; }
    if(legacy && typeof reader.changeFontSize === 'function') {
      const width = reader.$refs.renderTargetContainer?.clientWidth;
      if(width > 0) {
        // The legacy resize handler caches viewport width, which does not
        // change when only our gutters do. Recollect actual content width.
        if(contentWidth != null && contentWidth !== width) pendingReflow = true;
        contentWidth = width;
      }
    }
    restoreTypography();
    if(legacy) {
      if(enabled !== showPopular) lastDraw = null;
      enabled = !!showPopular;
      schedule();
      return true;
    }
    const chapter = document.querySelector('.wr_horizontalReader .readerChapterContent');
    if(!chapter || !render || !store._actions?.modifyCanvasOptions) return false;
    const width = chapter.clientWidth;
    if(width <= 0) return false;
    const between = Number(render.canvasXBetween) || 50;
    const limit = window.innerWidth < 1060 ? (width - 240) / 2 : width / 2 - between - 240;
    const padding = Math.max(4, Math.min(value, Math.max(4, Math.floor(limit))));
    const viewport = chapter.getBoundingClientRect();
    const boxes = selector => [...document.querySelectorAll(selector)].map(node => node.getBoundingClientRect());
    const insets = nativePagedInsets(viewport,
      boxes('.wr_horizontalReader .renderTargetPageInfo_header'),
      boxes('.wr_horizontalReader .renderTarget_pager_button'));
    if(!insets) return false;
    const {canvasTop, canvasBottom} = insets;
    if(render.canvasXAround !== padding || render.canvasTop !== canvasTop || render.canvasBottom !== canvasBottom) {
      store.dispatch('modifyCanvasOptions', { canvasXAround: padding, canvasTop, canvasBottom }).then(() => { if(!disposed && !reader._isDestroyed) window.dispatchEvent(new Event('resize')); }).catch(() => {});
    }
    return true;
  };
  return true;
};
      const walk = async (id, depth) => {
        if(!id || seen.has(id) || depth > 4 || inspected++ > 35 || found) return;
        seen.add(id);
        const props = await command('Runtime.getProperties', { objectId: id, ownProperties: true });
        for(const prop of props.result || []) {
          if(['fns', '__sentry_original__'].includes(prop.name) && prop.value?.objectId) await walk(prop.value.objectId, depth + 1);
        }
        const scopesId = (props.internalProperties || []).find(prop => prop.name === '[[Scopes]]')?.value?.objectId;
        if(!scopesId || found) return;
        const scopes = await command('Runtime.getProperties', { objectId: scopesId, ownProperties: true });
        for(const scope of scopes.result || []) {
          if(!scope.value?.objectId || /Global|Script/.test(scope.value.description || '')) continue;
          const vars = await command('Runtime.getProperties', { objectId: scope.value.objectId, ownProperties: true });
          for(const variable of vars.result || []) {
            const value = variable.value;
            if(value?.type !== 'object' || !value.objectId || ['Array', 'Window', 'Document'].includes(value.className)) continue;
            // Official chapter loading reads stack-frame filenames. Label this
            // dynamic script and keep a newline after the sourceURL comment.
            const result = await command('Runtime.callFunctionOn', { objectId: value.objectId, objectGroup: group, returnByValue: true, functionDeclaration: bind.toString()+'\n//# sourceURL=weread-pocket-native-reader.js\n' });
            if(result.result?.value === true) { found = true; return; }
          }
          for(const variable of vars.result || []) {
            if(variable.value?.type === 'function' && variable.value.objectId) await walk(variable.value.objectId, depth + 1);
            if(found) return;
          }
        }
      };
      try {
        const result = await command('Runtime.evaluate', {
          expression: '(() => { const b = document.querySelector(".readerControls button.isHorizontalReader, .readerControls button.isNormalReader"); if(!b) return null; const events = getEventListeners(b).click || []; return events.slice(-1)[0]?.listener; })()',
          includeCommandLineAPI: true, objectGroup: group
        });
        await walk(result.result?.objectId, 0);
      } finally {
        await guest.debugger.sendCommand('Runtime.releaseObjectGroup', { objectGroup: group }).catch(() => {});
        if(!alreadyAttached && !guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach();
      }
      return found && current() ? !!await apply() : false;
    } catch { return false; }
  }
  async refreshReaderLayout() {
    if(!this.ready || !this.webview) return;
    try {
      // CSS padding alone does not notify the native canvas renderer. Wait
      // until the content box is laid out, then request its normal resize pass.
      await this.syncNativeReaderPadding();
      await this.refreshFontControls();
      const reflow = this.webview.executeJavaScript('(() => { let done = false; const reflow = () => { if(done) return; done = true; if(document.querySelector(".readerChapterContent")) window.dispatchEvent(new Event("resize")); }; requestAnimationFrame(() => requestAnimationFrame(reflow)); setTimeout(reflow, 100); })()');
      // Reparenting the guest can discard a pending renderer callback. A host
      // deadline keeps later appearance updates from waiting on that document.
      await Promise.race([reflow.catch(() => {}), new Promise(resolve => setTimeout(resolve, 250))]);
    } catch { /* A navigation or detached webview may invalidate the document. */ }
  }
  setReadingFlow(flow) {
    const task = (this.readingFlowTask || Promise.resolve()).then(() => this.changeReadingFlow(flow));
    this.readingFlowTask = task.catch(() => false);
    return task;
  }
  async changeReadingFlow(flow) {
    if(this.unloaded) return false;
    if(!['scroll', 'paged'].includes(flow)) return false;
    if(flow==='paged'&&this.isLiteratureEnabled()) {new Notice('请先关闭文献卡片外观，再使用分页阅读');return false;}
    if(!this.ready || !this.webview) { new Notice('请先打开一本书，再切换阅读方式'); return false; }
    try {
      await this.syncNativeReaderPadding();
      const requested = await this.webview.executeJavaScript(`typeof window.__wrpSetReadingFlow === 'function' && window.__wrpSetReadingFlow(${JSON.stringify(flow)})`);
      if(!requested) { new Notice('请先打开一本书，再切换阅读方式'); return false; }
      for(let attempt = 0; attempt < 60; attempt++) {
        if(this.ready) {
          try {
            const current = await this.webview.executeJavaScript('document.querySelector(".readerChapterContent") ? (document.querySelector(".wr_horizontalReader") ? "paged" : "scroll") : null');
            if(current === flow) {
              this.settings.readingFlow = flow; this.persist();
              // A paged request started in an ordinary view may finish after
              // moving into a card view. Reconcile that newest location.
              if(flow === 'paged' && this.isLiteratureEnabled()) void this.applyAppearance();
              return true;
            }
          } catch { /* The official switch reloads its document. */ }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      new Notice('阅读方式尚未切换，请等网页加载完成后重试');
      return false;
    } catch { new Notice('阅读方式暂时无法切换，请稍后重试'); return false; }
  }
  turnPage(key) { if(this.ready) {this.webview.focus(); this.webview.sendInputEvent({type:'keyDown',keyCode:key}); this.webview.sendInputEvent({type:'keyUp',keyCode:key});} }
  async openCatalog() {
    if(!this.ready || !this.webview) { new Notice('请先打开一本书'); return false; }
    try {
      // Keep native chapter navigation available when its bottom bar is hidden.
      const opened = await this.webview.executeJavaScript(`(() => {
        const button = document.querySelector(".wr_page_reader .readerBottomBar button.catalog") || document.querySelector(".wr_page_reader .readerControls button.catalog");
        if(!button) return false;
        button.click();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const area = document.querySelector(".readerCatalog_list_scroll_area");
          const selected = area?.querySelector(".readerCatalog_list_item_selected");
          if(!selected || area.clientHeight <= 0) return;
          const item = selected.getBoundingClientRect(), box = area.getBoundingClientRect();
          area.scrollTop += item.top - box.top - Math.max(0, (area.clientHeight - item.height) / 2);
        }));
        return true;
      })()`);
      if(!opened) new Notice('请先打开一本书，再查看目录');
      return opened;
    } catch { new Notice('目录暂时无法打开，请稍后重试'); return false; }
  }
  setPocketDock(enabled) {
    this.settings.dockPocket = !!enabled;
    this.cancelAutoHide(); this.updateButtons(); this.persist();
    if(enabled) {
      if(this.readerLeaf) this.collapseToPocket();
      else this.show();
      return this.ensurePocketDock();
    }
    this.releasePocketDock();
    if(this.visible && !this.readerLeaf) { this.panel.hidden = false; this.layout(); this.applyAppearance(); }
    return Promise.resolve(true);
  }
  ensurePocketDock() {
    const queued = (this.dockOpenTask || Promise.resolve()).catch(() => {}).then(async () => {
      if(this.unloaded || !this.settings.dockPocket || !this.visible || this.expanded || this.readerLeaf) return false;
      const workspace = this.app.workspace;
      if(this.dockLeaf) { workspace.rightSplit.expand(); this.applyPocketDockHeight(); return true; }
      // A split side leaf creates a separate bottom tab group. The existing
      // upper group keeps its selected tool and all of its tabs.
      const leaf = workspace.getRightLeaf(true);
      if(!leaf) throw new Error('当前工作区无法创建侧栏分区');
      try {
        await leaf.setViewState({ type: 'weread-pocket-dock-v1', active: true });
        if(this.unloaded || !this.settings.dockPocket || !this.visible || this.expanded || this.readerLeaf) {
          if(this.dockLeaf === leaf) this.releasePocketDock(); else await leaf.detach();
          return false;
        }
        if(this.dockLeaf !== leaf) throw new Error('小窗未能停靠');
        workspace.rightSplit.expand();
        this.applyPocketDockHeight();
        workspace.requestSaveLayout?.();
        return true;
      } catch(error) {
        if(this.dockLeaf === leaf) this.releasePocketDock(); else await leaf.detach();
        throw error;
      }
    });
    this.dockOpenTask = queued;
    queued.catch(error => {
      if(this.unloaded) return;
      if(this.panel && this.visible && !this.expanded) { this.panel.hidden = false; this.layout(); }
      new Notice(`小窗停靠失败：${error.message || error}`);
    }).finally(() => { if(this.dockOpenTask === queued) this.dockOpenTask = null; });
    return queued;
  }
  applyPocketDockHeight() {
    if(!this.dockLeaf || this.unloaded) return;
    const right = this.app.workspace.rightSplit;
    let group = this.dockLeaf.parent;
    while(group?.parent && group.parent !== right) group = group.parent;
    if(group?.parent !== right) return;
    const others = right.children.filter(child => child !== group);
    const total = right.containerEl.clientHeight;
    if(!others.length || !total) return;
    // The bottom edge of this native pane stays fixed while its height changes.
    // Only a bottom toolbar can release vertical space without moving buttons.
    // Other edges hide the reading body while retaining the pane's dimensions.
    const compactHeight=this.dockCollapsed&&this.pocketToolbarPosition()==='bottom';
    const height = compactHeight ? (this.panel.querySelector('.wrp-header')?.getBoundingClientRect().height || 30) : Math.min(Math.max(160, Number(this.settings.dockHeight) || 280), Math.max(120, total - 120));
    const percent = Math.max(1, Math.min(99, height / total * 100));
    const weight = child => Number(child.dimension) > 0 ? Number(child.dimension) : 1;
    const sum = others.reduce((value, child) => value + weight(child), 0);
    for(const child of others) child.setDimension((100 - percent) * weight(child) / sum);
    group.setDimension(percent);
    this.app.workspace.requestSaveLayout?.();
  }
  setPocketDockHeight(height) {
    this.settings.dockHeight = Math.max(160, Math.min(600, Number(height) || 280));
    if(this.dockCollapsed) this.setPocketDockCollapsed(false);
    this.applyPocketDockHeight(); this.persist();
  }
  setDockAutoCollapse(enabled) {
    this.settings.dockAutoCollapse = !!enabled;
    if(!enabled) this.setPocketDockCollapsed(false);
    this.updateButtons(); this.persist();
  }
  setPocketDockCollapsed(collapsed) {
    if(!this.dockLeaf || this.expanded || !this.visible || this.dockCollapsed === !!collapsed) return;
    this.cancelAutoHide();
    if(collapsed) {
      const height = this.panel.getBoundingClientRect().height;
      if(height > 100) this.settings.dockHeight = Math.round(height);
      // Keep the hidden guest at its current dimensions, so shrinking the
      // native pane does not repaginate the book or change its scroll position.
      this.panel.style.setProperty('--wrp-dock-body-height', `${this.body.getBoundingClientRect().height}px`);
    }
    this.dockCollapsed = !!collapsed;
    this.panel.classList.toggle('is-dock-collapsed', this.dockCollapsed);
    this.autoButton?.setAttribute('aria-expanded', String(!this.dockCollapsed));
    this.applyPocketDockHeight();
    // Pane resizing is sometimes a no-op, so neither ResizeObserver nor a
    // workspace event runs. Clear the retained layer's hidden state now.
    this.syncReadingSurface();this.requestReadingSurfaceLayout();
    if(!collapsed && this.ready) void this.refreshReaderLayout();
    this.persist();
  }
  releasePocketDock() {
    const leaf = this.dockLeaf, view = this.dockView;
    this.dockLeaf = null; this.dockView = null;
    this.dockCollapsed = false;
    view?.tabs?.containerEl.classList.remove('wrp-pocket-dock-tabs');
    if(this.panel) {
      this.panel.classList.remove('is-docked');
      this.panel.classList.remove('is-dock-collapsed');
      if(this.panel.parentElement !== document.body) {
        document.body.appendChild(this.panel);
      }
      this.layout();
    }
    if(leaf) void leaf.detach();
  }
  readingLocation() { return this.readerLeaf?(this.isReaderInSidebar()?'sidebar':'tab'):(this.settings.dockPocket?'dock':'floating'); }
  toggle() {
    // Complete a pending restore before handling the next press. The webpage
    // remains connected; only its host pane and visibility change.
    const task=(this.readerToggleTask||Promise.resolve()).then(()=>this.toggleReaderNow());
    this.readerToggleTask=task.catch(()=>false);return this.readerToggleTask;
  }
  async toggleReaderNow() {
    if(this.unloaded) return false;
    if(this.visible) {
      if(this.dockLeaf&&this.dockCollapsed) this.setPocketDockCollapsed(false);
      else this.hide();
      return true;
    }
    const location=this.lastReadingLocation;
    if(location==='sidebar'||location==='tab') await this.openReader(location);
    else {this.show();if(this.dockOpenTask) await this.dockOpenTask;}
    this.syncReadingSurface();this.requestReadingSurfaceLayout();return true;
  }
  show() {
    if(this.readerLeaf) { void this.app.workspace.revealLeaf(this.readerLeaf); return; }
    if(!this.panel) this.build(); this.cancelAutoHide();
    if(!this.visible) { this.autoHideArmed = false; this.pointerInPocket = false; }
    if(!this.ready || this.styledNavigationRevision !== this.navigationRevision) this.setAppearancePending(true);
    this.visible=true; this.panel.hidden=!!this.settings.dockPocket && !this.dockLeaf;
    this.layout(); this.status?.addClass('is-active');
    if(this.settings.dockPocket) void this.ensurePocketDock();
    if(this.appearancePending && this.ready) this.applyAppearance();
  }
  hide() {
    if(this.visible||this.readerLeaf) this.lastReadingLocation=this.readingLocation();
    if(this.readerLeaf) { this.collapseToPocket(true); return; }
    this.cancelAutoHide(); if(!this.panel) return;
    this.visible=false; this.panel.hidden=true; this.status?.removeClass('is-active'); this.guestFocused=false; this.autoHideArmed=false; this.pointerInPocket=false;
    this.releasePocketDock();
    this.syncReadingSurface();
    const editor=this.app.workspace.activeEditor?.editor; if(editor) editor.focus();
  }
  isReaderInSidebar(leaf = this.readerLeaf) { return !!leaf && leaf.getRoot() === this.app.workspace.rightSplit; }
  openReaderTab() { return this.openReader('tab'); }
  openReaderSidebar() { return this.openReader('sidebar'); }
  openReader(location) {
    // Serialize rapid switches so only one view owns the reading guest.
    const task = (this.readerOpenTask || Promise.resolve()).then(() => this.moveReader(location));
    this.readerOpenTask = task.catch(e => new Notice(`打开阅读器失败：${e.message || e}`));
    return this.readerOpenTask;
  }
  async moveReader(location) {
    if(this.unloaded) return;
    if(!this.panel) this.build();
    this.cancelAutoHide();
    const workspace = this.app.workspace;
    if(this.readerLeaf && this.isReaderInSidebar() === (location === 'sidebar')) {
      await workspace.revealLeaf(this.readerLeaf);
      this.readerView?.updateLocation();
      return;
    }
    const previous = {leaf:this.readerLeaf, view:this.readerView, parent:this.surfaceHost || this.body, expanded:this.expanded, visible:this.visible};
    // getRightLeaf(false) adds a tab alongside existing sidebar tools.
    const leaf = location === 'sidebar' ? workspace.getRightLeaf(false) : workspace.getLeaf('tab');
    if(!leaf) throw new Error('当前工作区无法创建阅读页');
    try {
      await leaf.setViewState({ type: 'weread-pocket-reader-v2', active: true });
      await workspace.revealLeaf(leaf);
      if(this.readerLeaf !== leaf) throw new Error('阅读页未能加载');
      if(previous.leaf && previous.leaf !== leaf) await previous.leaf.detach();
      this.status?.addClass('is-active');
      this.readerView?.updateLocation();
      await this.applyAppearance();
    } catch(e) {
      // Retain the previous host if creating the destination fails.
      this.readerLeaf = previous.leaf;
      this.readerView = previous.view;
      this.expanded = previous.expanded;
      this.visible = previous.visible;
      if(previous.parent) this.mountWebview(previous.parent);
      this.panel.hidden = previous.expanded || !previous.visible;
      await leaf.detach();
      await this.applyAppearance();
      if(!previous.expanded && this.settings.dockPocket && this.visible) void this.ensurePocketDock();
      throw e;
    }
  }
  collapseToPocket(hide = false, detachLeaf = true) {
    if(hide&&(this.visible||this.readerLeaf)) this.lastReadingLocation=this.readingLocation();
    this.cancelAutoHide();
    const leaf = this.readerLeaf;
    this.readerLeaf = null;
    this.expanded = false;
    this.visible = !hide;
    this.guestFocused = false;
    if(this.readingSurface && this.body && this.surfaceHost !== this.body) this.mountWebview(this.body);
    if(leaf && detachLeaf) leaf.detach();
    if(this.panel) { this.panel.hidden = !!hide; if(!hide) this.show(); }
    if(hide) this.status?.removeClass('is-active');
    this.layout(); this.applyAppearance();
    this.syncReadingSurface();
  }
  expand() { if(this.readerLeaf) { this.collapseToPocket(); return; } this.cancelAutoHide(); void this.openReaderTab(); }
  onunload() { this.unloaded = true; clearTimeout(this.literatureAppearanceTimer); clearInterval(this.readerHeaderTimer); this.releasePocketDock(); this.ready = false; this.updateFontButtons(); clearTimeout(this.saveTimer); this.cancelAutoHide(); clearTimeout(this.reflowTimer); clearTimeout(this.appearanceRetryTimer); clearTimeout(this.nativeLayoutRetryTimer); clearTimeout(this.fontStateRetryTimer); clearTimeout(this.themeRefreshTimer); if(this.surfaceLayoutFrame != null) cancelAnimationFrame(this.surfaceLayoutFrame); this.surfaceResizeObserver?.disconnect(); this.releaseWeReadWebview(); this.readingSurface?.remove(); this.appearanceRevision = (this.appearanceRevision || 0) + 1; this.unbindGuestKeys(); this.resizeObserver?.disconnect(); this.readerResizeObserver?.disconnect(); this.themeObserver?.disconnect(); this.panel?.remove(); }
}
class PocketDockView extends ViewBase {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return 'weread-pocket-dock-v1'; }
  getDisplayText() { return '阅读小窗'; }
  getIcon() { return 'book-open'; }
  async onOpen() {
    const p = this.plugin;
    if(p.unloaded || !p.settings.dockPocket || p.expanded) return;
    if(!p.panel) p.build();
    if(p.dockLeaf && p.dockLeaf !== this.leaf) p.releasePocketDock();
    const root = this.containerEl; root.empty(); root.addClass('wrp-pocket-dock-view');
    this.tabs = this.leaf.parent;
    this.tabs.containerEl.classList.add('wrp-pocket-dock-tabs');
    p.dockLeaf = this.leaf; p.dockView = this;
    p.cancelAutoHide(); p.visible = true; p.expanded = false;
    root.appendChild(p.panel); p.panel.hidden = false;
    p.layout(); p.updateButtons(); p.applyPocketDockHeight();
    p.status?.addClass('is-active'); p.applyAppearance();
  }
  async onClose() {
    this.tabs?.containerEl.classList.remove('wrp-pocket-dock-tabs');
    if(this.plugin.dockLeaf === this.leaf) {
      // The native pane is already closing; release ownership before hiding.
      this.plugin.dockLeaf = null; this.plugin.dockView = null;
      this.plugin.hide();
    }
  }
}
class ReaderView extends ViewBase {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return 'weread-pocket-reader-v2'; }
  getDisplayText() { if(this.plugin.isLocalSource()&&!this.plugin.isLiteratureEnabled(this.plugin.isReaderInSidebar(this.leaf)?'sidebar':'tab'))return this.plugin.localBook?.title||'本地书架'; return this.plugin.isLiteratureEnabled(this.plugin.isReaderInSidebar(this.leaf)?'sidebar':'tab')?(this.plugin.settings.literatureTitle.trim()||LITERATURE_DEFAULTS.title):'微信读书'; }
  getIcon() { return 'book-open'; }
  updateLocation() {
    const sidebar = this.plugin.isReaderInSidebar(this.leaf);
    this.containerEl.classList.toggle('wrp-reader-sidebar', sidebar);
    const label = sidebar ? '移至工作区标签页阅读' : '移至右侧栏阅读';
    if(this.moveButton) { setIcon(this.moveButton, sidebar ? 'panels-top-left' : 'panel-right-open'); this.moveButton.title = label; this.moveButton.setAttribute('aria-label', label); }
  }
  showMoreMenu(event) {
    const menu = new Menu(), p = this.plugin;
    menu.addItem(item => item.setTitle('本地书架').setIcon('library').onClick(() => p.showBookshelf()));
    menu.addItem(item => item.setTitle('首页').setIcon('home').onClick(() => p.navigatePage('https://weread.qq.com/')));
    menu.addItem(item => item.setTitle('我的书架 / 登录').setIcon('library').onClick(() => p.navigatePage(HOME)));
    const cardLocation=p.isReaderInSidebar(this.leaf)?'sidebar':'tab';
    menu.addItem(item => item.setTitle(p.isLiteratureEnabled(cardLocation)?'关闭此位置的文献卡片':'启用此位置的文献卡片').setIcon('file-text').onClick(()=>p.setLiteratureDisguise(!p.isLiteratureEnabled(cardLocation),cardLocation)));
    const underlineMode=p.underlineProfileMode(cardLocation);
    if(!p.isLocalSource())menu.addItem(item => item.setTitle(p.isPopularUnderlinesEnabled(cardLocation,underlineMode)?'隐藏此位置的热门划线与笔记入口':'显示此位置的热门划线与笔记入口').setIcon('highlighter').onClick(()=>p.setPopularUnderlines(!p.isPopularUnderlinesEnabled(cardLocation,underlineMode),cardLocation,underlineMode)));
    if(!p.isLocalSource()&&this.headerData?.addLabel) menu.addItem(item => item.setTitle(this.headerData.addLabel).setIcon('book-plus').setDisabled(this.headerData.addDisabled).onClick(() => p.addCurrentBookToShelf()));
    if(!p.isReaderInSidebar(this.leaf)) {
      menu.addSeparator();
      menu.addItem(item => item.setTitle('移至右侧栏').setIcon('panel-right-open').onClick(() => p.openReaderSidebar()));
      menu.addItem(item => item.setTitle('收回小窗').setIcon('minimize-2').onClick(() => p.collapseToPocket()));
    }
    this.moreMenu = menu;
    menu.showAtMouseEvent(event);
  }
  async onOpen() {
    // A sidebar view may be restored before a floating pocket was ever built.
    if(!this.plugin.panel) this.plugin.build();
    this.plugin.expanded = true;
    this.plugin.visible = true;
    this.plugin.panel.hidden = true;
    const root = this.containerEl; root.empty(); root.addClass('wrp-reader-view');
    // View-owned listeners are released by Obsidian when this tab closes.
    const button = (...args) => this.plugin.button(...args, this);
    const bar = root.createDiv({ cls: 'wrp-reader-toolbar' });
    this.titleEl = bar.createSpan({ text: this.getDisplayText(), cls: 'wrp-reader-title', attr:{id:`wrp-reader-label-${this.leaf.id}`} });
    this.addShelfButton = button(bar, 'book-plus', '加入书架', () => this.plugin.addCurrentBookToShelf());
    this.addShelfButton.addClass('wrp-reader-secondary'); this.addShelfButton.hidden = true;
    button(bar, 'home', '首页', () => this.plugin.navigatePage('https://weread.qq.com/')).addClass('wrp-reader-secondary');
    button(bar, 'library', '书架 · 切换正文来源', () => this.plugin.showBookshelf());
    button(bar, 'list', '打开章节目录', () => this.plugin.openCatalog());
    this.plugin.addFontButtons(bar, this);
    this.plugin.addLayoutControls(bar, root, false, this);
    button(bar, 'rotate-cw', '重新加载官方页面', () => this.plugin.reloadPage());
    this.moveButton = button(bar, 'panel-right-open', '移至右侧栏阅读', () => this.plugin.isReaderInSidebar(this.leaf) ? this.plugin.openReaderTab() : this.plugin.openReaderSidebar());
    this.moveButton.classList.add('wrp-reader-secondary', 'wrp-reader-window-control');
    this.pocketButton = button(bar, 'minimize-2', '收回小窗', () => this.plugin.collapseToPocket());
    this.pocketButton.classList.add('wrp-reader-secondary', 'wrp-reader-window-control');
    const more = button(bar, 'ellipsis', '更多阅读操作', event => this.showMoreMenu(event));
    more.addClass('wrp-reader-more');
    button(bar, 'x', '关闭阅读器', () => this.plugin.hide());
    const host = root.createDiv({ cls: 'wrp-reader-host' });
    this.plugin.mountWebview(host);
    this.plugin.releasePocketDock();
    this.plugin.readerView = this;
    this.plugin.readerLeaf = this.leaf;
    this.plugin.status?.addClass('is-active');
    this.updateLocation();
    this.plugin.applyAppearance();
  }
  async onClose() {
    this.moreMenu?.hide(); this.moreMenu = null;
    this.plugin.layoutControls = (this.plugin.layoutControls || []).filter(entry => entry.root !== this.containerEl);
    this.plugin.fontButtons = (this.plugin.fontButtons || []).filter(entry => entry.root !== this.containerEl);
    if(this.plugin.readerView === this) this.plugin.readerView = null;
    // The tab is already closing; hide the retained guest without detaching
    // the same leaf again. Explicit "收回小窗" still opens the pocket.
    if(this.plugin.readerLeaf === this.leaf) this.plugin.collapseToPocket(true, false);
  }
}
class PocketSettings extends PluginSettingTab {
  constructor(app,plugin) {super(app,plugin); this.plugin=plugin;}
  section(parent, id, title, description, collapsible = false) {
    const section = parent.createEl(collapsible ? 'details' : 'section', {cls:'wrp-settings-section'});
    section.dataset.wrpSection = id;
    if(collapsible) {
      section.open = !!this.sectionOpen?.[id];
      section.createEl('summary', {text:title});
      section.addEventListener('toggle', () => {
        this.sectionOpen = this.sectionOpen || {};
        this.sectionOpen[id] = section.open;
      });
    } else new Setting(section).setName(title).setHeading();
    const body = section.createDiv({cls:'wrp-settings-section-body'});
    if(description) body.createEl('p', {cls:'wrp-settings-note', text:description});
    return body;
  }
  slider(row, min, max, step, value, format, change) {
    row.settingEl.addClass('wrp-settings-slider-row');
    const valueEl = row.controlEl.createEl('output', {cls:'wrp-settings-value', text:format(value)});
    let control;
    row.addSlider(s => {
      control = s;
      s.setLimits(min,max,step).setValue(value).setDynamicTooltip();
      s.sliderEl.setAttribute('aria-label', row.nameEl.textContent);
      s.onChange(v => { valueEl.setText(format(v)); void change(v); });
    });
    return {setValue(v) {control.setValue(v); valueEl.setText(format(v));},setDisabled(v){control.sliderEl.disabled=!!v;}};
  }
  renderUnderlinePreferences(el, mode) {
    el.empty(); const p=this.plugin, modeLabel=mode==='card'?'文献卡片':'普通阅读';
    for(const [key,label] of Object.entries(LAYOUT_LABELS)) {
      let toggle;
      const update=async value=>{
        toggle.setDisabled(true);
        try {await p.setPopularUnderlines(value,key,mode);} finally {
          toggle.setValue(p.isPopularUnderlinesEnabled(key,mode)).setDisabled(false);
        }
      };
      new Setting(el).setName(label).setDesc(`${modeLabel}：显示热门划线与笔记入口。仅影响这个位置。`)
        .addToggle(t=>{toggle=t;t.toggleEl.setAttribute('aria-label',`${modeLabel} · ${label}显示热门划线与笔记入口`);t.setValue(p.isPopularUnderlinesEnabled(key,mode)).onChange(update);})
        .addButton(b=>b.setButtonText('恢复默认').onClick(()=>update(true)));
    }
  }
  renderLayout(el, key) {
    el.empty(); const p=this.plugin, profile=p.layoutProfile(key);
    const reset = (row, option, refresh) => row.addButton(b => b.setButtonText('恢复默认').onClick(async () => {
      await p.resetLayoutOption(option,key); refresh();
    }));
    const fontRow = new Setting(el).setName('正文字号').setDesc(`10–42 px，默认 ${p.defaultLayoutValue('font',key)} px。`);
    let fontControl;
    fontRow.addDropdown(d => {
      fontControl=d;
      d.addOptions(Object.fromEntries(FONT_SIZES.map(size=>[String(size),size+' px']))).setValue(String(profile.fontSizePx)).onChange(async v => {
        await p.setProfileOption(key,'fontSizePx',v);
        d.setValue(String(p.layoutProfile(key).fontSizePx));
      });
    });
    reset(fontRow,'font',()=>fontControl.setValue(String(p.layoutProfile(key).fontSizePx)));
    const lineRow = new Setting(el).setName('正文行间距').setDesc(`每行文字的高度为字号的 1.0–3.0 倍，默认 ${p.defaultLayoutValue('line',key)} 倍。`);
    const line = this.slider(lineRow,1,3,0.1,profile.lineHeight,v=>Number(v).toFixed(1)+' 倍',async v => {
      await p.setProfileOption(key,'lineHeight',v); line.setValue(p.layoutProfile(key).lineHeight);
    });
    reset(lineRow,'line',()=>line.setValue(p.layoutProfile(key).lineHeight));
    const paragraphRow = new Setting(el).setName('正文段间距').setDesc(`段落之间的总间隔，0–80 px，默认 ${p.defaultLayoutValue('paragraph',key)} px。0 px 去掉原有段距，行间距单独调整。`);
    const paragraph = this.slider(paragraphRow,0,80,2,profile.paragraphSpacing,v=>v+' px',async v => {
      await p.setProfileOption(key,'paragraphSpacing',v); paragraph.setValue(p.layoutProfile(key).paragraphSpacing);
    });
    reset(paragraphRow,'paragraph',()=>paragraph.setValue(p.layoutProfile(key).paragraphSpacing));
    const paddingRow = new Setting(el).setName('左右留白').setDesc(`左右各留相同距离，4–320 px，默认 ${p.defaultLayoutValue('padding',key)} px。`);
    const padding = this.slider(paddingRow,4,320,4,profile.contentPadding,v=>v+' px',async v => {
      await p.setProfileOption(key,'contentPadding',v); padding.setValue(p.layoutProfile(key).contentPadding);
    });
    reset(paddingRow,'padding',()=>padding.setValue(p.layoutProfile(key).contentPadding));
  }
  display() {
    const el=this.containerEl; el.empty(); el.addClass('wrp-settings'); const p=this.plugin;
    new Setting(el).setName('WeRead Pocket 阅读器').setHeading();
    el.createEl('p',{cls:'wrp-settings-intro',text:'这里管理阅读偏好。书架、章节目录、窗口切换和当前排版可直接使用阅读工具栏；同一快捷键可收起并恢复原阅读位置。'});

    const reading=this.section(el,'reading','阅读偏好','作用于所有阅读位置。');
    p.renderLocalBookSettings(reading);
    const toggleRow=new Setting(reading).setName('收起 / 恢复快捷键');
    const refreshToggle=()=>{p.updateShortcutHints();toggleRow.setDesc(`当前：${p.commandHotkeyLabel('toggle')}。默认 Ctrl+Alt+R，按一下收起，再按一下恢复到原来的小窗、侧栏或标签页；正文获得焦点时也生效。`);};
    refreshToggle();
    toggleRow.addButton(b=>b.setButtonText('更改快捷键').onClick(()=>p.openReaderToggleHotkeys()));
    toggleRow.addButton(b=>b.setButtonText('恢复默认').onClick(async()=>{await p.resetReaderToggleHotkey();refreshToggle();}));
    new Setting(reading).setName('外观').setDesc('跟随主界面时，使用 Obsidian 当前主题的背景和文字颜色。').addDropdown(d=>d.addOptions({auto:'跟随主界面',dark:'深色',light:'浅色'}).setValue(p.settings.appearance).onChange(v=>p.setThemeMode(v)));
    let flowControl;
    new Setting(reading).setName('阅读方式').setDesc('连续滚动可上下滚动正文；分页使用上一页、下一页。文献卡片使用连续滚动。请在书籍打开后切换。').addDropdown(d=>{flowControl=d;d.addOptions({scroll:'连续上下滚动',paged:'分页阅读'}).setValue(p.settings.readingFlow).setDisabled(p.isLiteratureEnabled()).onChange(async v=>{
      d.setDisabled(true);
      try {await p.setReadingFlow(v);} finally {
        d.setValue(p.settings.readingFlow).setDisabled(p.isLiteratureEnabled());
      }
    });});
    const navigation=this.section(el,'navigation','阅读控制快捷键','在 Obsidian 主界面操作时也能控制当前阅读器，保持主界面的键盘焦点。本地与微信读书共用，适用于各窗口和文献卡片；分页模式下上下滚动键用于前后翻页。');
    for(const [id,command] of Object.entries(READER_NAVIGATION_COMMANDS)) {
      const row=new Setting(navigation).setName(command.name);
      const refresh=()=>row.setDesc('当前：'+p.commandHotkeyLabel(id)+'。'+(command.action==='scroll'?'连续滚动时每次约三行，可按住滚动。':'按一下切换一个章节。'));
      refresh();
      row.addButton(b=>b.setButtonText('更改快捷键').onClick(()=>p.openReaderCommandHotkeys(id)));
      row.addButton(b=>b.setButtonText('恢复默认').onClick(async()=>{await p.resetReaderCommandHotkey(id);refresh();}));
    }
    const underlines=this.section(el,'underlines','热门划线与笔记','普通阅读与文献卡片分别记忆，每种模式再按阅读位置设置。开启后，点击正文的热门虚线可查看公开想法；分页时由官方阅读器控制，设置将在连续滚动时使用。');
    const underlineMode=this.editingUnderlineMode || p.underlineProfileMode();
    let underlineFields;
    new Setting(underlines).setName('编辑哪种模式').setDesc('选择只切换下方设置，不改变当前阅读器。每项恢复默认为开启。').addDropdown(d=>d.addOptions({reading:'普通阅读',card:'文献卡片'}).setValue(underlineMode).onChange(v=>{this.editingUnderlineMode=v;this.renderUnderlinePreferences(underlineFields,v);}));
    underlineFields=underlines.createDiv({cls:'wrp-settings-underline-fields'});
    this.renderUnderlinePreferences(underlineFields,underlineMode);

    const literature=this.section(el,'literature','文献卡片外观','分别选择使用卡片的位置。开启的位置显示自定义英文摘录和原生小说正文；关闭的位置使用普通阅读，切换窗口时自动应用。');
    let refreshLayoutMode,refreshZoomMode;
    const disguiseControls={};
    const setDisguise=async(value,key)=>{
      const toggle=disguiseControls[key];toggle.setDisabled(true);
      try {await p.setLiteratureDisguise(value,key);} finally {
        toggle.setValue(p.isLiteratureEnabled(key)).setDisabled(false);
        flowControl.setValue(p.settings.readingFlow).setDisabled(p.isLiteratureEnabled());
        refreshLayoutMode?.();refreshZoomMode?.();
      }
    };
    const locationDescriptions={floating:'独立浮动的阅读小窗。',dock:'固定在右侧栏底部的小窗，上方保留其他插件。',sidebar:'占据完整右侧栏的阅读页面。',tab:'与笔记文件并列的工作区标签页。'};
    for(const [key,label] of Object.entries(LAYOUT_LABELS)) {
      new Setting(literature).setName(label+'使用文献卡片').setDesc(locationDescriptions[key])
        .addToggle(t=>{disguiseControls[key]=t;t.setValue(p.isLiteratureEnabled(key)).onChange(v=>setDisguise(v,key));})
        .addButton(b=>b.setButtonText('恢复默认').onClick(()=>setDisguise(false,key)));
    }
    let literatureTitle;
    new Setting(literature).setName('文献标题').setDesc('显示在阅读顶栏，最长 160 个字符。').addText(t=>{literatureTitle=t;t.inputEl.maxLength=160;t.setValue(p.settings.literatureTitle).onChange(v=>p.setLiteraturePreference('literatureTitle',v));}).addButton(b=>b.setButtonText('恢复默认').onClick(()=>{literatureTitle.setValue(LITERATURE_DEFAULTS.title);p.setLiteraturePreference('literatureTitle',LITERATURE_DEFAULTS.title);}));
    let literatureEnglish;
    const englishRow=new Setting(literature).setName('英文摘录').setDesc('每段英文用空行分隔，卡片会按顺序循环使用；一段英文会重复显示。最多 12,000 个字符，仅作为纯文本展示。');
    englishRow.settingEl.addClass('wrp-literature-editor-row');
    englishRow.addTextArea(t=>{literatureEnglish=t;t.inputEl.rows=7;t.inputEl.maxLength=12000;t.inputEl.spellcheck=false;t.inputEl.setAttribute('aria-label','文献卡片英文摘录');t.setValue(p.settings.literatureEnglish).onChange(v=>p.setLiteraturePreference('literatureEnglish',v));});
    englishRow.addButton(b=>b.setButtonText('恢复默认').onClick(()=>{literatureEnglish.setValue(LITERATURE_DEFAULTS.english);p.setLiteraturePreference('literatureEnglish',LITERATURE_DEFAULTS.english);}));
    const groupsRow=new Setting(literature).setName('每张卡片的小说段落数').setDesc('1–6 段，默认 3 段。默认 12 px、1.3 倍行高，字体跟随主题，英文与中文一致，内缩 8 px。顶栏可调整，四种窗口分别记忆；普通阅读的排版另行保留。热门划线在「热门划线与笔记」中按模式和位置单独设置。');
    const groups=this.slider(groupsRow,1,6,1,p.settings.literatureParagraphs,v=>v+' 段',v=>p.setLiteraturePreference('literatureParagraphs',v));
    groupsRow.addButton(b=>b.setButtonText('恢复默认').onClick(()=>{groups.setValue(3);p.setLiteraturePreference('literatureParagraphs',3);}));

    const pocket=this.section(el,'pocket','小窗行为','浮动小窗与侧栏底部小窗分别记忆收起方式；侧栏小窗还可单独选择展开方式。');
    let updatePocketOptions,toolbarControl;
    const interactionControls={};
    const interactionRow=(parent,name,description,field,options)=>{
      const row=new Setting(parent).setName(name).setDesc(description);
      row.addDropdown(d=>{
        interactionControls[field]=d;
        d.addOptions(options).setValue(p.settings[field]).onChange(v=>p.setPocketInteraction(field,v));
      });
      row.addButton(b=>b.setButtonText('恢复默认').onClick(()=>{
        p.setPocketInteraction(field,DEFAULTS[field]);interactionControls[field].setValue(p.settings[field]);
      }));
    };
    const hideOptions={leave:'鼠标移出后收起',click:'移出后点击外部收起'};
    new Setting(pocket).setName('小窗固定到右侧栏底部').setDesc('开启后切换到底部小窗，上方保留其他插件；关闭后恢复浮动小窗。工具栏也可切换。').addToggle(t=>t.setValue(p.settings.dockPocket).onChange(async v=>{
      const task=p.setPocketDock(v); updatePocketOptions(); await task;
    }));
    const toolbarRow=new Setting(pocket).setName('小窗工具栏位置');
    toolbarRow.addDropdown(d=>{toolbarControl=d;d.addOptions(POCKET_TOOLBAR_POSITIONS).setValue(p.pocketToolbarPosition()).onChange(v=>p.setPocketToolbarPosition(v));});
    toolbarRow.addButton(b=>b.setButtonText('恢复默认').onClick(()=>{
      p.setPocketToolbarPosition(DEFAULTS[p.settings.dockPocket?'dockToolbarPosition':'pocketToolbarPosition']);toolbarControl.setValue(p.pocketToolbarPosition());
    }));
    const floating=pocket.createDiv({cls:'wrp-settings-dependent'});
    new Setting(floating).setName('浮动小窗自动隐藏').setDesc('按下面选择的方式隐藏整个小窗，使用收起 / 恢复快捷键再次打开。放大阅读时暂停。').addToggle(t=>t.setValue(p.settings.autoHide).onChange(v=>{p.settings.autoHide=v;p.updateButtons();p.persist();updatePocketOptions();}));
    interactionRow(floating,'浮动小窗收起方式','移出模式会等待 450 毫秒，移回可取消；点击模式在点击小窗外部时隐藏。','pocketHideTrigger',hideOptions);
    const dock=pocket.createDiv({cls:'wrp-settings-dependent'});
    const heightRow=new Setting(dock).setName('侧栏底部小窗高度').setDesc('展开时的高度，160–600 px。也可拖动上下分栏的分界线。');
    this.slider(heightRow,160,600,1,Math.max(160,Math.min(600,p.settings.dockHeight)),v=>v+' px',v=>p.setPocketDockHeight(v));
    new Setting(dock).setName('侧栏底部小窗自动收缩').setDesc('收起时隐藏正文并保留工具栏。收起和展开的触发方式可分别选择，工具栏保持原位。').addToggle(t=>t.setValue(p.settings.dockAutoCollapse).onChange(v=>{p.setDockAutoCollapse(v);updatePocketOptions();}));
    interactionRow(dock,'侧栏小窗收起方式','移出模式会等待 450 毫秒，移回可取消；点击模式允许先移出，点击小窗外部后才收起。','dockHideTrigger',hideOptions);
    interactionRow(dock,'侧栏小窗展开方式','移入工具栏即可展开，或点击工具栏后展开。收起状态下，第一次点击只展开，不执行按钮操作。','dockExpandTrigger',{hover:'移入工具栏展开',click:'点击工具栏展开'});
    updatePocketOptions=()=>{
      floating.hidden=p.settings.dockPocket; dock.hidden=!p.settings.dockPocket;
      interactionControls.pocketHideTrigger.setDisabled(!p.settings.autoHide);
      interactionControls.dockHideTrigger.setDisabled(!p.settings.dockAutoCollapse);
      interactionControls.dockExpandTrigger.setDisabled(!p.settings.dockAutoCollapse);
      toolbarControl.setValue(p.pocketToolbarPosition());
      toolbarRow.setDesc(p.settings.dockPocket?'侧栏底部小窗：默认下面，收缩时释放高度；其他位置保留分栏高度，避免工具栏跳动。与浮动小窗分别记忆。':'浮动小窗：默认上面，可选择四条边。拖动工具栏可移动小窗；与侧栏底部小窗分别记忆。');
    };
    updatePocketOptions();

    const layout=this.section(el,'layout','各窗口排版',`当前编辑${p.isLiteratureEnabled(this.editingLayoutProfile||p.layoutProfileKey())?'文献卡片':'普通阅读'}的排版，与顶栏面板共用。本地原书排版不套用这组设置；选择自定义后生效。普通阅读和卡片互不覆盖。`,true);
    const profileKey=this.editingLayoutProfile||p.layoutProfileKey();
    let layoutFields;
    new Setting(layout).setName('编辑哪个位置').setDesc(`当前阅读位置：${LAYOUT_LABELS[p.layoutProfileKey()]}。选择下面的位置不会移动阅读器。`).addDropdown(d=>d.addOptions(LAYOUT_LABELS).setValue(profileKey).onChange(v=>{this.editingLayoutProfile=v;refreshLayoutMode();}));
    layoutFields=layout.createDiv({cls:'wrp-settings-layout-fields'}); this.renderLayout(layoutFields,profileKey);
    refreshLayoutMode=()=>{
      layout.querySelector('.wrp-settings-note').setText(`当前编辑${p.isLiteratureEnabled(this.editingLayoutProfile||p.layoutProfileKey())?'文献卡片':'普通阅读'}的排版，与顶栏面板共用。按所选位置的开关编辑，普通阅读和卡片互不覆盖。`);
      this.renderLayout(layoutFields,this.editingLayoutProfile||p.layoutProfileKey());
    };

    const web=this.section(el,'interface','阅读界面','调整微信读书网页中的工具。插件自己的阅读顶栏始终保留。');
    new Setting(web).setName('隐藏网页底部栏').setDesc('隐藏书城、目录和 App 阅读提示，所有位置生效。章节目录仍可从阅读顶栏打开。').addToggle(t=>t.setValue(p.settings.hideBottomBar).onChange(v=>{p.settings.hideBottomBar=v;p.applyAppearance();p.persist();}));
    new Setting(web).setName('小窗隐藏官方工具栏').setDesc('隐藏网页的顶部导航和圆形工具，适用于两种小窗。标签页和完整右侧栏阅读不受此开关影响。').addToggle(t=>t.setValue(p.settings.compact).onChange(v=>{p.settings.compact=v;p.applyAppearance();p.persist();}));
    new Setting(web).setName('标签页／侧栏的官方工具位置').setDesc('调整网页中的圆形工具，例如目录、AI 和划线。').addDropdown(d=>d.addOptions({right:'右侧',left:'左侧',hidden:'隐藏'}).setValue(p.settings.controlsPosition).onChange(v=>{p.settings.controlsPosition=v;p.applyAppearance();p.persist();}));

    const advanced=this.section(el,'advanced','高级选项','两种小窗共用以下目录字号和网页缩放设置。',true);
    const catalogRow=new Setting(advanced).setName('小窗目录字号').setDesc('章节目录和搜索框的字号，10–16 px，默认 12 px。');
    const catalog=this.slider(catalogRow,10,16,1,p.settings.catalogFontSize||12,v=>v+' px',v=>{p.settings.catalogFontSize=v;p.applyAppearance();p.persist();});
    catalogRow.addButton(b=>b.setButtonText('恢复默认').onClick(()=>{p.settings.catalogFontSize=12;catalog.setValue(12);p.applyAppearance();p.persist();}));
    const zoomRow=new Setting(advanced).setName('小窗网页缩放').setDesc('普通阅读为 50–150%，默认 90%。文献卡片固定 100%，使卡片和主界面比例一致；文字大小使用排版设置。');
    const zoom=this.slider(zoomRow,0.5,1.5,0.05,p.settings.zoom,v=>Math.round(v*100)+'%',v=>{p.settings.zoom=v;p.applyAppearance();p.persist();});
    let zoomReset;
    zoomRow.addButton(b=>{zoomReset=b;b.setButtonText('恢复默认').onClick(()=>{p.settings.zoom=DEFAULTS.zoom;zoom.setValue(DEFAULTS.zoom);p.applyAppearance();p.persist();});});
    refreshZoomMode=()=>{zoom.setDisabled(p.isLiteratureEnabled(true));zoomReset.setDisabled(p.isLiteratureEnabled(true));};refreshZoomMode();
    new Setting(advanced).setName('重置浮动小窗位置与大小').setDesc('恢复为 380 × 280 px 和默认位置。保留排版、侧栏高度以及当前阅读位置。').addButton(b=>b.setButtonText('重置小窗').onClick(()=>p.resetPocketBounds()));


  }
}
// WRP_LOCAL_BOOKS_START
const createLocalBookStore = (function createLocalBookStore(options = {}) {
  // EPUB is indexed in place. Only the selected chapter and requested images
  // are decoded; local files are never extracted, rewritten or sent online.
  const fs = options.fs || require('node:fs');
  const path = options.path || require('node:path');
  const zlib = options.zlib || require('node:zlib');
  const Decoder = options.TextDecoder || TextDecoder;
  const limits = {epubBytes:512*1024*1024, txtBytes:128*1024*1024, entries:20000,
    centralBytes:16*1024*1024, xmlBytes:8*1024*1024, chapterBytes:16*1024*1024,
    imageBytes:8*1024*1024, txtChapterBytes:4*1024*1024, lineBytes:1024*1024,
    styleBytes:256*1024, styleTotalBytes:512*1024, styleSources:16, styleDepth:8,
    styleCacheEntries:8, styleCacheBytes:512*1024,
    ...options.limits};
  const fail = message => { throw new Error(message); };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const textDecoder = (encoding, fatal = false) => new Decoder(encoding, {fatal});
  const utf8 = buffer => textDecoder('utf-8', true).decode(buffer).replace(/^\uFEFF/, '');
  const bookText = buffer => {
    if(buffer.length>=2&&buffer[0]===255&&buffer[1]===254)return textDecoder('utf-16le',true).decode(buffer).replace(/^\uFEFF/,'');
    if(buffer.length>=2&&buffer[0]===254&&buffer[1]===255)return textDecoder('utf-16be',true).decode(buffer).replace(/^\uFEFF/,'');
    return utf8(buffer);
  };
  const crcTable = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0; }
  const crc32 = bytes => { let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0; };
  const entity = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name) => {
    if(name[0]==='#') { const code=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);
      return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'\ufffd'; }
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name.toLowerCase()];
  });
  const localName = name => name.toLowerCase().split(':').pop();
  function attributes(source) {
    const result={},regex=/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;let match;
    while((match=regex.exec(source)))result[localName(match[1])]=entity(match[2]??match[3]??match[4]);
    return result;
  }
  function publisherElement(source,name) {
    const match=source.match(new RegExp('<(?:[\\w.-]+:)?'+name+'\\b([^>]*)>','i'));
    const attrs=match?attributes(match[1]):{};
    return {className:(attrs.class||'').slice(0,4096),id:(attrs.id||'').slice(0,4096),
      style:(attrs.style||'').slice(0,4096),lang:(attrs.lang||'').slice(0,128)};
  }
  // Locate top-level imports without treating comments or quoted text as CSS.
  // Source bytes and recursion are bounded before local ZIP entries are read.
  function cssImports(source) {
    const imports=[];let depth=0,quote='',comment=false;
    for(let index=0;index<source.length;index++) {
      const char=source[index],next=source[index+1];
      if(comment){if(char==='*'&&next==='/'){comment=false;index++;}continue;}
      if(quote){if(char==='\\'){index++;continue;}if(char===quote)quote='';continue;}
      if(char==='/'&&next==='*'){comment=true;index++;continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if(char==='{'){depth++;continue;}if(char==='}'){depth=Math.max(0,depth-1);continue;}
      if(depth||char!=='@'||!/^@import\b/i.test(source.slice(index,index+8)))continue;
      const start=index;let end=index+7,innerQuote='',parentheses=0;
      for(;end<source.length;end++) {
        const current=source[end];
        if(innerQuote){if(current==='\\')end++;else if(current===innerQuote)innerQuote='';continue;}
        if(current==='"'||current==="'")innerQuote=current;
        else if(current==='(')parentheses++;
        else if(current===')')parentheses=Math.max(0,parentheses-1);
        else if((current===';'&&!parentheses)||current==='{'||current==='}')break;
      }
      const stop=end<source.length&&source[end]===';'?end+1:end;
      const statement=source.slice(start,stop);
      const parsed=statement.match(/^@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)|"([^"]*)"|'([^']*)')\s*([^;{}]*);$/i);
      imports.push({start,end:stop,href:parsed?(parsed[1]??parsed[2]??parsed[3]??parsed[4]??parsed[5]):'',media:parsed?parsed[6].trim():''});
      index=Math.max(index,stop-1);
    }
    return imports;
  }
  // A bounded XML reader supports namespace prefixes, comments and CDATA.
  // Harmless DOCTYPE declarations are ignored; entity declarations/internal
  // subsets are rejected and external identifiers are never fetched.
  function xml(source) {
    if (/<!\s*ENTITY\b/i.test(source)||/<!\s*DOCTYPE[^>]*\[/i.test(source)) fail('EPUB 的 XML 包含不支持的实体声明。');
    source=source.replace(/<!\s*DOCTYPE[^<>[\]]*>/gi, '');
    const root={name:'root',attrs:{},children:[],parts:[]},stack=[root];
    const tokens=source.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g)||[];
    if(tokens.length>200000) fail('EPUB 目录结构过于复杂。');
    for(const token of tokens) {
      const parent=stack[stack.length-1];
      if(token.startsWith('<!--')||token.startsWith('<?'))continue;
      if(token.startsWith('<![CDATA[')){parent.parts.push(token.slice(9,-3));continue;}
      if(token.startsWith('</')) {
        const match=token.match(/^<\/\s*([\w:.-]+)\s*>$/);
        if(!match||stack.length===1||stack[stack.length-1].qualified!==match[1])fail('EPUB XML 标签不完整。');
        stack.pop();continue;
      }
      if(token.startsWith('<')) {
        const match=token.match(/^<\s*([\w:.-]+)([\s\S]*?)\/?\s*>$/);
        if(!match||token.startsWith('<!'))fail('EPUB XML 格式无法识别。');
        const attrs={};
        const rest=match[2].replace(/\/\s*$/, '');
        const regex=/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;let attribute;
        while((attribute=regex.exec(rest)))attrs[localName(attribute[1])]=entity(attribute[2]??attribute[3]);
        const node={name:localName(match[1]),qualified:match[1],attrs,children:[],parts:[]};
        parent.children.push(node);parent.parts.push(node);
        if(!/\/\s*>$/.test(token)){stack.push(node);if(stack.length>100)fail('EPUB XML 嵌套过深。');}
      } else parent.parts.push(entity(token));
    }
    if(stack.length!==1)fail('EPUB XML 标签未闭合。');
    return root;
  }
  const descendants = (node, name) => {
    const result=[];const visit=current=>{for(const child of current.children){if(child.name===name)result.push(child);visit(child);}};visit(node);return result;
  };
  const nodeText = node => clean(node.parts.map(part=>typeof part==='string'?part:nodeText(part)).join(''));
  function entryName(name) {
    if(!name||name.includes('\0')||name.includes('\\')||/^(?:\/|[a-z]:)/i.test(name))fail('EPUB 包含不安全的文件路径。');
    const segments=name.split('/');if(segments.some(part=>part==='.'||part==='..'))fail('EPUB 包含越界文件路径。');
    return name;
  }
  function resolveHref(href, base) {
    if(typeof href!=='string'||!href.trim())return null;
    const value=href.trim();
    if(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//')||value.startsWith('/')||value.includes('\\')||value.includes('\0'))return null;
    const hash=value.indexOf('#');let anchor='';
    try { anchor=hash<0?'':decodeURIComponent(value.slice(hash+1)); } catch { return null; }
    const resource=(hash<0?value:value.slice(0,hash)).split('?')[0];
    let decoded;try { decoded=decodeURIComponent(resource); } catch { return null; }
    if(decoded.includes('\\')||decoded.includes('\0')||decoded.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(decoded))return null;
    const resolved=resource?path.posix.normalize(path.posix.join(path.posix.dirname(base),decoded)):base;
    if(resolved==='..'||resolved.startsWith('../')||resolved.startsWith('/'))return null;
    return {href:resolved,anchor};
  }
  async function readAt(handle, offset, length) {
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0)fail('图书文件偏移无效。');
    const buffer=Buffer.alloc(length);let done=0;
    while(done<length){const result=await handle.read(buffer,done,length-done,offset+done);if(!result.bytesRead)fail('图书文件不完整。');done+=result.bytesRead;}
    return buffer;
  }
  async function openEpub(handle, fileSize, filePath) {
    const maxTail=Math.min(fileSize,65557);if(maxTail<22)fail('EPUB 不是完整的 ZIP 文件。');
    let tailLength=22,tail,eocd=-1,tailBytes=0;
    while(true) {
      tail=await readAt(handle,fileSize-tailLength,tailLength);tailBytes+=tailLength;
      for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){eocd=i;break;}
      if(eocd>=0||tailLength===maxTail)break;tailLength=Math.min(maxTail,tailLength*4);
    }
    if(eocd<0)fail('EPUB 不是完整的 ZIP 文件。');
    const disk=tail.readUInt16LE(eocd+4),centralDisk=tail.readUInt16LE(eocd+6);
    const count=tail.readUInt16LE(eocd+10),diskCount=tail.readUInt16LE(eocd+8);
    const centralSize=tail.readUInt32LE(eocd+12),centralOffset=tail.readUInt32LE(eocd+16);
    if(disk||centralDisk||count!==diskCount)fail('暂不支持分卷 EPUB。');
    if(count===65535||centralSize===0xffffffff||centralOffset===0xffffffff)fail('暂不支持 ZIP64 EPUB。');
    if(!count||count>limits.entries||centralSize>limits.centralBytes||centralOffset+centralSize>fileSize-tailLength+eocd)fail('EPUB 文件索引无效或过大。');
    const central=await readAt(handle,centralOffset,centralSize),entries=new Map();let offset=0,totalBytes=0;
    for(let index=0;index<count;index++) {
      if(offset+46>central.length||central.readUInt32LE(offset)!==0x02014b50)fail('EPUB 文件索引损坏。');
      const flags=central.readUInt16LE(offset+8),method=central.readUInt16LE(offset+10),crc=central.readUInt32LE(offset+16);
      const compressed=central.readUInt32LE(offset+20),size=central.readUInt32LE(offset+24);
      const nameLength=central.readUInt16LE(offset+28),extraLength=central.readUInt16LE(offset+30),commentLength=central.readUInt16LE(offset+32);
      const startDisk=central.readUInt16LE(offset+34),attributes=central.readUInt32LE(offset+38),localOffset=central.readUInt32LE(offset+42);
      if(offset+46+nameLength+extraLength+commentLength>central.length)fail('EPUB 文件索引不完整。');
      if(flags&0x41)fail('暂不支持加密 EPUB，请导入可直接打开的图书。');
      if(method!==0&&method!==8)fail('EPUB 使用了不支持的压缩方式。');
      if(startDisk||compressed===0xffffffff||size===0xffffffff||localOffset===0xffffffff)fail('暂不支持分卷或 ZIP64 EPUB。');
      if(((attributes>>>16)&0xf000)===0xa000)fail('EPUB 不允许包含符号链接。');
      let name;try{name=entryName(utf8(central.subarray(offset+46,offset+46+nameLength)));}catch(error){if(error.message.startsWith('EPUB'))throw error;fail('EPUB 文件名编码无效。');}
      if(entries.has(name))fail('EPUB 包含重复文件。');
      if(size>64*1024*1024||compressed>64*1024*1024||size>Math.max(1024*1024,compressed*1000))fail('EPUB 压缩条目过大。');
      totalBytes+=size;if(totalBytes>1024*1024*1024)fail('EPUB 解压后内容过大。');
      if(localOffset+30>centralOffset)fail('EPUB 文件位置无效。');
      entries.set(name,{name,flags,method,crc,compressed,size,offset:localOffset});
      offset+=46+nameLength+extraLength+commentLength;
    }
    if(offset!==central.length)fail('EPUB 文件索引含有无法识别的内容。');
    let closed=false,readBytes=tailBytes+centralSize,chapterReads=0,resourceReads=0,styleReads=0,cssCacheBytes=0;
    const cssCache=new Map(),pendingStyles=new Map();
    async function entryBytes(name,maxBytes) {
      if(closed)fail('图书已关闭。');
      const entry=entries.get(name);if(!entry)fail('EPUB 缺少文件：'+name);
      if(entry.size>maxBytes||entry.compressed>maxBytes+65536)fail('EPUB 内容超过单次读取上限。');
      if(entry.method===0&&entry.compressed!==entry.size)fail('EPUB 存储条目长度无效。');
      const header=await readAt(handle,entry.offset,30);readBytes+=header.length;
      if(header.readUInt32LE(0)!==0x04034b50||header.readUInt16LE(8)!==entry.method||(header.readUInt16LE(6)&0x41))fail('EPUB 文件头损坏。');
      const nameLength=header.readUInt16LE(26),extraLength=header.readUInt16LE(28);
      const dataOffset=entry.offset+30+nameLength+extraLength;
      if(dataOffset+entry.compressed>centralOffset)fail('EPUB 条目越过文件边界。');
      const rawName=await readAt(handle,entry.offset+30,nameLength);
      if(utf8(rawName)!==name)fail('EPUB 文件头与索引不一致。');
      const raw=await readAt(handle,dataOffset,entry.compressed);readBytes+=nameLength+raw.length;
      let result;
      try { result=entry.method===0?raw:zlib.inflateRawSync(raw,{maxOutputLength:maxBytes}); }
      catch { fail('EPUB 压缩内容损坏。'); }
      if(result.length!==entry.size||crc32(result)!==entry.crc)fail('EPUB 内容校验失败。');
      return result;
    }
    async function stylesheetText(name) {
      const cached=cssCache.get(name);
      if(cached){cssCache.delete(name);cssCache.set(name,cached);return cached.text;}
      if(pendingStyles.has(name))return pendingStyles.get(name);
      const pending=(async()=>{
        const entry=entries.get(name);if(!entry||entry.size>limits.styleBytes)return '';
        let text;try{text=bookText(await entryBytes(name,limits.styleBytes));}catch{return '';}
        styleReads++;const bytes=Buffer.byteLength(text,'utf8');
        if(!closed&&bytes<=limits.styleCacheBytes&&limits.styleCacheEntries>0) {
          while(cssCache.size&&(cssCache.size>=limits.styleCacheEntries||cssCacheBytes+bytes>limits.styleCacheBytes)) {
            const first=cssCache.keys().next().value;cssCacheBytes-=cssCache.get(first).bytes;cssCache.delete(first);
          }
          cssCache.set(name,{text,bytes});cssCacheBytes+=bytes;
        }
        return text;
      })();
      pendingStyles.set(name,pending);
      try{return await pending;}finally{pendingStyles.delete(name);}
    }
    async function chapterStyles(html,base) {
      const head=html.match(/<(?:[\w.-]+:)?head\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?head\s*>/i)?.[1]||'';
      const styles=[],state={sources:0,sourceBytes:0},visited=new Set();let outputBytes=0;
      async function expand(text,currentBase,depth) {
        const bytes=Buffer.byteLength(text,'utf8');
        if(!text||bytes>limits.styleBytes||state.sources>=limits.styleSources||state.sourceBytes+bytes>limits.styleTotalBytes)return '';
        state.sources++;state.sourceBytes+=bytes;
        const fragments=[];let offset=0;
        for(const imported of cssImports(text)) {
          fragments.push(text.slice(offset,imported.start));offset=imported.end;
          const resolved=resolveHref(imported.href,currentBase),entry=resolved&&entries.get(resolved.href);
          if(!entry||depth>=limits.styleDepth||visited.has(resolved.href)||entry.size>limits.styleBytes||entry.size+state.sourceBytes>limits.styleTotalBytes||state.sources>=limits.styleSources)continue;
          // Media queries remain local. Unsupported import modifiers are ignored.
          if(imported.media&&(imported.media.length>1024||/[{}@<>]/.test(imported.media)||/\b(?:layer|supports)\s*\(/i.test(imported.media)))continue;
          visited.add(resolved.href);
          const nested=await expand(await stylesheetText(resolved.href),resolved.href,depth+1);
          visited.delete(resolved.href);
          if(nested)fragments.push(imported.media?'@media '+imported.media+' {\n'+nested+'\n}':nested);
        }
        fragments.push(text.slice(offset));return fragments.join('\n');
      }
      const tags=head.replace(/<!--[\s\S]*?-->/g,'').match(/<(?:[\w.-]+:)?style\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?style\s*>|<(?:[\w.-]+:)?link\b[^>]*>/gi)||[];
      for(const tag of tags) {
        if(state.sources>=limits.styleSources||state.sourceBytes>=limits.styleTotalBytes)break;
        const opener=tag.match(/^<[^\s>]+([^>]*)>/),attrs=attributes(opener?.[1]||'');let text='',currentBase=base;
        if(/^<(?:[\w.-]+:)?link\b/i.test(tag)) {
          if(!(attrs.rel||'').toLowerCase().split(/\s+/).includes('stylesheet'))continue;
          const resolved=resolveHref(attrs.href,base),entry=resolved&&entries.get(resolved.href);
          if(!entry||entry.size>limits.styleBytes||entry.size+state.sourceBytes>limits.styleTotalBytes)continue;
          currentBase=resolved.href;visited.add(currentBase);text=await stylesheetText(currentBase);
        } else {
          text=tag.slice(opener[0].length).replace(/<\/(?:[\w.-]+:)?style\s*>$/i,'');
          text=text.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/,'$1');text=entity(text);
        }
        const expanded=await expand(text,currentBase,0);visited.delete(currentBase);
        if(!expanded)continue;
        let wrapped=expanded;
        if(attrs.media&&attrs.media.length<=1024&&!/[{}@<>]/.test(attrs.media))wrapped='@media '+attrs.media+' {\n'+expanded+'\n}';
        const bytes=Buffer.byteLength(wrapped,'utf8');
        if(outputBytes+bytes<=limits.styleTotalBytes){styles.push(wrapped);outputBytes+=bytes;}
      }
      return styles;
    }
    async function xmlEntry(name){try{return xml(bookText(await entryBytes(name,limits.xmlBytes)));}catch(error){if(error.message.startsWith('EPUB')||error.message==='图书已关闭。')throw error;fail('EPUB XML 编码无效。');}}
    const container=await xmlEntry('META-INF/container.xml');
    const rootfile=descendants(container,'rootfile').find(node=>node.attrs['media-type']==='application/oebps-package+xml')||descendants(container,'rootfile')[0];
    if(!rootfile?.attrs['full-path'])fail('EPUB 缺少内容清单。');
    const opfPath=entryName(rootfile.attrs['full-path']),opf=await xmlEntry(opfPath);
    const manifest=descendants(opf,'manifest')[0],spine=descendants(opf,'spine')[0];
    if(!manifest||!spine)fail('EPUB 缺少章节顺序。');
    const items=new Map();
    for(const item of manifest.children.filter(node=>node.name==='item')) {
      const resolved=resolveHref(item.attrs.href,opfPath);
      if(item.attrs.id&&resolved)items.set(item.attrs.id,{id:item.attrs.id,href:resolved.href,type:item.attrs['media-type']||'',properties:item.attrs.properties||''});
    }
    const chapters=[];
    for(const reference of spine.children.filter(node=>node.name==='itemref'&&node.attrs.linear!=='no')) {
      const item=items.get(reference.attrs.idref);
      if(!item||!entries.has(item.href)||!['application/xhtml+xml','text/html'].includes(item.type))fail('EPUB 正文清单包含缺失或不支持的章节。');
      chapters.push({id:item.id,title:'第 '+(chapters.length+1)+' 节',href:item.href});
    }
    if(!chapters.length)fail('EPUB 没有可阅读的章节。');
    if(entries.has('META-INF/encryption.xml')) {
      const encryption=await xmlEntry('META-INF/encryption.xml');
      const obfuscation=['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC'];
      for(const encrypted of descendants(encryption,'encrypteddata')) {
        const method=descendants(encrypted,'encryptionmethod')[0];
        if(!obfuscation.includes(method?.attrs.algorithm||''))fail('暂不支持加密 EPUB，请导入可直接打开的图书。');
        for(const reference of descendants(encrypted,'cipherreference')) {
          const resource=resolveHref(reference.attrs.uri,'encryption.xml');
          if(resource&&chapters.some(chapter=>chapter.href===resource.href))fail('EPUB 正文已加密，无法直接阅读。');
        }
      }
    }
    const navigation=[];
    const addNavigation=(title,href,base)=>{
      const resolved=resolveHref(href,base);if(!resolved)return;
      const chapterIndex=chapters.findIndex(chapter=>chapter.href===resolved.href);
      if(chapterIndex<0)return;const label=clean(title);if(!label)return;
      navigation.push({title:label,chapterIndex,anchor:resolved.anchor});
      if(chapters[chapterIndex].title.startsWith('第 ')&&(!resolved.anchor||!navigation.some(item=>item.chapterIndex===chapterIndex&&item!==navigation[navigation.length-1])))chapters[chapterIndex].title=label;
    };
    const navItem=[...items.values()].find(item=>item.properties.split(/\s+/).includes('nav'));
    const ncxItem=items.get(spine.attrs.toc)||[...items.values()].find(item=>item.type==='application/x-dtbncx+xml');
    if(navItem&&entries.has(navItem.href)) {
      const document=await xmlEntry(navItem.href);
      const nav=descendants(document,'nav').find(node=>(node.attrs.type||'').split(/\s+/).includes('toc'));
      if(nav)for(const link of descendants(nav,'a'))addNavigation(nodeText(link),link.attrs.href,navItem.href);
    }
    if(!navigation.length&&ncxItem&&entries.has(ncxItem.href)) {
      const document=await xmlEntry(ncxItem.href);
      for(const point of descendants(document,'navpoint')) {
        const label=point.children.find(node=>node.name==='navlabel'),content=point.children.find(node=>node.name==='content');
        if(label&&content)addNavigation(nodeText(label),content.attrs.src,ncxItem.href);
      }
    }
    if(!navigation.length)for(let index=0;index<chapters.length;index++)navigation.push({title:chapters[index].title,chapterIndex:index,anchor:''});
    const title=clean(nodeText(descendants(opf,'title')[0]||{parts:[]}))||path.basename(filePath,path.extname(filePath));
    const author=descendants(opf,'creator').map(nodeText).filter(Boolean).join('、');
    const mimeTypes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp'};
    return {title,author,format:'epub',chapters,navigation,
      resolveLink(href,chapterIndex=0) {
        const chapter=chapters[chapterIndex];if(!chapter)return null;
        const resolved=resolveHref(href,chapter.href);if(!resolved)return null;
        const target=chapters.findIndex(item=>item.href===resolved.href);
        return target<0?null:{chapterIndex:target,anchor:resolved.anchor};
      },
      async readChapter(index) {
        if(!Number.isInteger(index)||index<0||index>=chapters.length)fail('章节不存在。');
        const chapter=chapters[index];let html;
        try {html=bookText(await entryBytes(chapter.href,limits.chapterBytes));} catch(error){if(error.message.startsWith('EPUB')||error.message==='图书已关闭。')throw error;fail('EPUB 正文编码无效。');}
        chapterReads++;return {html,href:chapter.href,index,title:chapter.title,
          publisherStyles:await chapterStyles(html,chapter.href),publisherBody:publisherElement(html,'body'),publisherHtml:publisherElement(html,'html')};
      },
      async readResource(href,chapterIndex=0) {
        const chapter=chapters[chapterIndex];if(!chapter)return null;
        const resolved=resolveHref(href,chapter.href);if(!resolved)return null;
        const extension=path.posix.extname(resolved.href).slice(1).toLowerCase(),mime=mimeTypes[extension];
        const entry=entries.get(resolved.href);if(!mime||!entry||entry.size>limits.imageBytes)return null;
        const data=await entryBytes(resolved.href,limits.imageBytes);resourceReads++;return {mime,data};
      },
      async close(){if(closed)return;closed=true;entries.clear();cssCache.clear();cssCacheBytes=0;pendingStyles.clear();await handle.close();},
      stats(){return {fileSize,indexBytes:centralSize,entries:entries.size,readBytes,chapterReads,resourceReads,styleReads,cssCacheBytes,cssCacheEntries:cssCache.size,closed};}
    };
  }
  const heading = line => {
    const value=clean(line);if(!value||value.length>120)return null;
    return /^(?:第[〇零一二三四五六七八九十百千万两\d]{1,20}[章回卷节部篇集](?:\s|[：:、.．]|[^\d])?.*|chapter\s+(?:\d+|[ivxlcdm]+)\b.*|(?:序章|序言|前言|楔子|引子|尾声|后记|番外)(?:\s|[：:、.．]|$).*)$/i.test(value)?value:null;
  };
  async function openTxt(handle,fileSize,filePath) {
    const sample=await readAt(handle,0,Math.min(fileSize,65536));let encoding='utf-8',bom=0;
    if(sample.length>=3&&sample[0]===239&&sample[1]===187&&sample[2]===191)bom=3;
    else if(sample.length>=2&&sample[0]===255&&sample[1]===254){encoding='utf-16le';bom=2;}
    else if(sample.length>=2&&sample[0]===254&&sample[1]===255){encoding='utf-16be';bom=2;}
    else {
      let even=0,odd=0;for(let i=0;i<sample.length;i++)if(sample[i]===0){if(i%2)odd++;else even++;}
      if(odd>sample.length*.2&&even<sample.length*.02)encoding='utf-16le';
      else if(even>sample.length*.2&&odd<sample.length*.02)encoding='utf-16be';
      else if(even+odd>0)fail('TXT 含有二进制数据，无法作为文本阅读。');
      else try{textDecoder('utf-8',true).decode(sample,{stream:true});}catch{encoding='gb18030';}
    }
    const wide=encoding.startsWith('utf-16'),unit=wide?2:1;
    if(wide&&(fileSize-bom)%2)fail('TXT 的 UTF-16 文本不完整。');
    const decoder=textDecoder(encoding),chapters=[];let buffer=Buffer.alloc(0),base=bom,position=bom,hasText=false,readBytes=sample.length;
    let current={id:'text-0',title:'正文',start:bom,bodyStart:bom,end:fileSize},continuations=0,currentHasText=false,currentIsHeading=false;
    const flushChapter=end=>{current.end=end;if(currentHasText||currentIsHeading)chapters.push(current);if(chapters.length>limits.entries)fail('TXT 章节数量过多。');};
    function line(bytes,start,end) {
      const value=decoder.decode(bytes).replace(/\r$/, '');
      if(value.includes('\0'))fail('TXT 含有无法识别的控制字符。');
      if(clean(value))hasText=true;
      const label=heading(value);
      if(label) {
        flushChapter(start);continuations=0;
        current={id:'text-'+chapters.length,title:label,start,bodyStart:end,end:fileSize};currentHasText=false;currentIsHeading=true;
      } else if(start-current.bodyStart>=limits.txtChapterBytes) {
        const oldTitle=current.title.replace(/（续 \d+）$/, '');flushChapter(start);continuations++;
        current={id:'text-'+chapters.length,title:oldTitle+'（续 '+continuations+'）',start,bodyStart:start,end:fileSize};currentHasText=!!clean(value);currentIsHeading=false;
      } else if(clean(value))currentHasText=true;
    }
    while(position<fileSize) {
      const length=Math.min(65536,fileSize-position),chunk=await readAt(handle,position,length);readBytes+=chunk.length;position+=length;
      buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;
      let start=0;
      for(let i=0;i+unit<=buffer.length;i+=unit) {
        const newline=wide?(encoding==='utf-16le'?buffer[i]===10&&buffer[i+1]===0:buffer[i]===0&&buffer[i+1]===10):buffer[i]===10;
        if(!newline)continue;
        line(buffer.subarray(start,i),base+start,base+i+unit);start=i+unit;
      }
      if(start){buffer=buffer.subarray(start);base+=start;}
      if(buffer.length>limits.lineBytes)fail('TXT 单行过长，请使用包含正常换行的文本。');
    }
    if(buffer.length)line(buffer,base,fileSize);
    flushChapter(fileSize);
    if(!hasText)fail('TXT 没有可阅读的正文。');
    if(!chapters.length)chapters.push({...current,start:bom,bodyStart:bom,end:fileSize});
    let closed=false,chapterReads=0;
    return {title:path.basename(filePath,path.extname(filePath)),author:'',format:'txt',encoding,chapters,
      navigation:chapters.map((chapter,chapterIndex)=>({title:chapter.title,chapterIndex,anchor:''})),
      async readChapter(index) {
        if(closed)fail('图书已关闭。');
        if(!Number.isInteger(index)||index<0||index>=chapters.length)fail('章节不存在。');
        const chapter=chapters[index],length=chapter.end-chapter.bodyStart;
        if(length>limits.txtChapterBytes+limits.lineBytes)fail('TXT 章节内容超过读取上限。');
        const bytes=await readAt(handle,chapter.bodyStart,length);readBytes+=bytes.length;chapterReads++;
        const originalParagraphs=decoder.decode(bytes).replace(/^\uFEFF/, '').split(/\r?\n/).filter(value=>value.trim());
        const paragraphs=originalParagraphs.map(value=>value.trim());
        return {paragraphs,originalParagraphs,index,title:chapter.title};
      },
      async readResource(){return null;},
      async close(){if(closed)return;closed=true;await handle.close();},
      stats(){return {fileSize,indexBytes:chapters.length*128,encoding,readBytes,chapterReads,resourceReads:0,closed};}
    };
  }
  return {
    supportedFormats:['epub','txt'],
    async open(filePath) {
      if(typeof filePath!=='string'||!filePath.trim())fail('请选择本地图书文件。');
      const format=path.extname(filePath).slice(1).toLowerCase();
      if(!['epub','txt'].includes(format))fail('目前支持 EPUB 和 TXT 本地图书。');
      let handle;
      try {
        handle=await fs.promises.open(filePath,'r');const stat=await handle.stat();
        if(!stat.isFile())fail('请选择图书文件。');
        if(!stat.size)fail('图书文件为空。');
        if(stat.size>(format==='epub'?limits.epubBytes:limits.txtBytes))fail('图书文件过大：EPUB 上限 512 MiB，TXT 上限 128 MiB。');
        return await (format==='epub'?openEpub:openTxt)(handle,stat.size,filePath);
      } catch(error) {
        if(handle)await handle.close().catch(()=>{});
        if(error.code==='ENOENT')fail('找不到图书文件，请重新选择。');
        if(error.code==='EACCES'||error.code==='EPERM')fail('无法读取图书文件，请检查权限。');
        throw error;
      }
    }
  };
});
const createLocalReaderSurface = (function createLocalReaderSurface(options) {
  const doc = options.document || options.host.ownerDocument;
  const view = doc.defaultView;
  // WRP_LOCAL_PUBLISHER_START
  const createLocalPublisherTypography = (function createLocalPublisherTypography(document) {
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
});
  // WRP_LOCAL_PUBLISHER_END
  const publisherTypography = createLocalPublisherTypography(doc);
  const publisherScopePrefix = "wrp-publisher-" + Math.random().toString(36).slice(2);
  let publisherScopeSerial = 0;
  const colors = ['#ffd400', '#ff6666', '#5fb236', '#2ea8e5', '#a28ae5'];
  const blockSelector = 'p,li,h1,h2,h3,h4,h5,h6,pre,dt,dd,td,th';
  const allowedTags = new Set(['DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','FIGURE','FIGCAPTION','P','SPAN','STRONG','EM','B','I','U','S','DEL','SUB','SUP','BR','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','CODE','OL','UL','LI','DL','DT','DD','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','HR','A']);
  const forbiddenTags = new Set(['SCRIPT','STYLE','IFRAME','FRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SELECT','OPTION','TEXTAREA','LINK','META','BASE','SVG','MATH','NOSCRIPT','HEAD','TITLE']);
  const finite = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const root = element('div', 'wrp-local-reader');
  const scroll = element('div', 'wrp-local-scroll');
  const content = element('article', 'wrp-local-content');
  const status = element('div', 'wrp-local-status');
  root.tabIndex = 0;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '本地图书阅读');
  scroll.tabIndex = -1;
  status.setAttribute('role', 'status'); status.hidden = true;
  scroll.append(content); root.append(scroll, status); options.host.append(root);

  // Only a small chapter window owns text nodes or resources. Removed chapter
  // records are discarded rather than cached, so a long book stays inexpensive.
  let book = null, chapter = -1, config = {}, records = new Map();
  let disposed = false, generation = 0, progressTimer = null, frame = null, pendingRestore = null, deferredRestore = null;
  let catalog = null, imageBytes = 0, lastWheelTurn = 0, maxRenderedChapters = 0, pendingChapterReads = 0;
  let windowTask = null, windowDirty = false, maintenanceFrame = null, shortWindow = false, shortAdvance = null;
  let chapterNavigation = Promise.resolve(), bookRevision = 0;
  const failedAdjacent = new Set();
  let remembered = {chapter:0, paragraph:0, offset:0, percent:0};
  const maxChapters = 3;
  const requestFrame = callback => view?.requestAnimationFrame ? view.requestAnimationFrame(callback) : setTimeout(callback, 0);
  const cancelFrame = id => view?.cancelAnimationFrame ? view.cancelAnimationFrame(id) : clearTimeout(id);
  const invoke = (name, value) => { try { options[name]?.(value); } catch (_) { /* A host callback cannot invalidate a book. */ } };
  const publisherMode = () => config.localTypography === 'publisher' && !config.literature?.enabled;
  const continuous = () => config.continuousChapters === true && (config.readingFlow !== 'paged' || !!config.literature?.enabled);
  const showStatus = (message, error = false) => {
    status.textContent = message || ''; status.hidden = !message;
    status.classList.toggle('is-error', error);
    root.setAttribute('aria-busy', message && !error ? 'true' : 'false');
  };
  const releaseRecord = record => {
    record.alive = false;
    for (const [url, size] of record.resources) { view?.URL?.revokeObjectURL(url); imageBytes -= size; }
    record.resources.clear(); record.images = []; record.blocks = []; record.paragraphs = [];
    record.publisherTree = []; record.leadingWhitespace = []; record.publisherInline = []; record.publisherRoot?.remove(); record.publisherRoot = null; record.publisherHTML = null; record.publisherStyle = null;
    record.node.remove(); records.delete(record.index);
    imageBytes = Math.max(0, imageBytes);
  };
  const releaseResources = () => { for (const record of [...records.values()]) releaseRecord(record); };
  const welcome = () => {
    content.replaceChildren();
    const empty = element('div', 'wrp-local-empty');
    empty.append(element('h3', '', '本地书架'), element('p', '', '点击顶栏的书架按钮，添加 EPUB 或 TXT 图书。'));
    content.append(empty);
  };
  const safePath = (href, base) => {
    if (typeof href !== 'string' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href.trim()) || /[\u0000-\u001f]/.test(href)) return null;
    try {
      const url = new URL(href, 'https://wrp.invalid/' + String(base || '').replace(/^\/+/, ''));
      if (url.origin !== 'https://wrp.invalid') return null;
      return {path:decodeURIComponent(url.pathname).replace(/^\/+/, ''), anchor:decodeURIComponent(url.hash.slice(1))};
    } catch (_) { return null; }
  };
  const chapterPath = item => safePath(String(item?.href || item?.path || item?.id || ''), '')?.path || '';
  const makeAnchor = (source, target) => {
    const name = source.getAttribute('id') || (source.tagName === 'A' && source.getAttribute('name'));
    if (name) target.dataset.wrpAnchor = name.slice(0, 512);
  };
  const sanitize = (node, record) => {
    if (node.nodeType === 3) return doc.createTextNode(node.nodeValue || '');
    if (node.nodeType !== 1 || forbiddenTags.has(node.tagName)) return null;
    if (node.tagName === 'IMG') {
      const holder = element('span', 'wrp-local-image-placeholder', node.getAttribute('alt') ? '图像：' + node.getAttribute('alt') : '图像');
      makeAnchor(node, holder);
      const href = node.getAttribute('src');
      if (href && safePath(href, record.href) && typeof book?.readResource === 'function' && record.images.length < 100) record.images.push({holder, href, alt:node.getAttribute('alt') || '', publisherAttributes:{className:node.getAttribute('class'),id:node.getAttribute('id'),style:node.getAttribute('style'),lang:node.getAttribute('lang')}, loaded:false});
      return holder;
    }
    const tag = node.tagName;
    const target = allowedTags.has(tag) ? doc.createElement(tag.toLowerCase()) : doc.createDocumentFragment();
    if (target.nodeType === 1) {
      makeAnchor(node, target); publisherTypography.attributes(node, target, record);
      if (tag === 'A') {
        const href = node.getAttribute('href');
        if (href && safePath(href, record.href)) {
          target.dataset.wrpLocalHref = href; target.setAttribute('href', '#'); target.setAttribute('role', 'link');
        }
      }
      if (tag === 'TD' || tag === 'TH') for (const name of ['colspan','rowspan']) {
        const size = finite(node.getAttribute(name), 1, 1, 32);
        if (size > 1) target.setAttribute(name, String(Math.round(size)));
      }
      if (tag === 'OL') {
        const start = Number(node.getAttribute('start'));
        if (Number.isSafeInteger(start) && start !== 1) target.setAttribute('start', String(start));
      }
    } else if (node.getAttribute('id')) {
      const anchor = element('span', 'wrp-local-anchor'); anchor.dataset.wrpAnchor = node.getAttribute('id').slice(0, 512); target.append(anchor);
    }
    for (const child of node.childNodes) { const clean = sanitize(child, record); if (clean) target.append(clean); }
    return target;
  };
  const makeRecord = (payload, index) => {
    const record = {index, href:payload.href || book.chapters[index]?.href || '', blocks:[], paragraphs:[], titleAnchors:[], images:[], publisherInline:[], leadingWhitespace:[], whitespaceNormalized:false, publisherTree:[], resources:new Map(), alive:true, imageTask:null, node:element('section', 'wrp-local-chapter')};
    record.node.dataset.wrpChapter = String(index);
    const holder = element('div');
    if (Array.isArray(payload.paragraphs)) {
      for (const value of Array.isArray(payload.originalParagraphs) ? payload.originalParagraphs : payload.paragraphs) {
        const text = typeof value === 'string' ? value : value?.text;
        if (typeof text === 'string' && text.trim()) holder.append(element('p', 'wrp-local-text-paragraph', text));
      }
    } else if (typeof payload.html === 'string') {
      // Parse into inert template contents and copy only an allowlist. Author
      // scripts, styling, event handlers and external URLs never become live.
      const template = doc.createElement('template'); template.innerHTML = payload.html;
      const body = template.content.querySelector('body') || template.content;
      for (const child of body.childNodes) { const clean = sanitize(child, record); if (clean) holder.append(clean); }
    } else throw new Error('这个章节没有可读取的正文。');
    for (const node of [...holder.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre,blockquote')]) {
      if (!node.textContent.trim() && !node.querySelector('.wrp-local-image-placeholder,[data-wrp-anchor]')) node.remove();
    }
    const wrappers = new Set(['DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','FIGURE','FIGCAPTION']);
    const collectBlocks = parent => {
      let inline = null;
      for (const node of [...parent.childNodes]) {
        if (node.nodeType === 1 && wrappers.has(node.tagName)) { inline = null; collectBlocks(node); }
        else if (node.nodeType === 1 && /^(P|H[1-6]|BLOCKQUOTE|PRE|OL|UL|DL|TABLE|HR)$/.test(node.tagName)) { inline = null; record.blocks.push(node); }
        else if ((node.nodeType === 3 && node.nodeValue.trim()) || node.nodeType === 1) {
          if (!inline) { inline = element('p'); parent.insertBefore(inline,node); record.blocks.push(inline); } inline.append(node);
        }
      }
    };
    collectBlocks(holder);
    record.publisherRoot = element('div','wrp-local-publisher');
    record.publisherRoot.id = publisherScopePrefix + '-' + (++publisherScopeSerial);
    record.publisherHTML = element('wrp-publisher-html'); record.publisherHTML.dataset.wrpPublisherHtml = '';
    const publisherBody = element('wrp-publisher-body'); publisherBody.dataset.wrpPublisherBody = '';
    publisherTypography.attributes(payload.publisherHtml,record.publisherHTML,record);
    publisherTypography.attributes(payload.publisherBody,publisherBody,record);
    publisherBody.append(...holder.childNodes); record.publisherHTML.append(publisherBody);
    record.publisherRoot.append(record.publisherHTML);
    record.publisherRoot.classList.toggle('is-txt',Array.isArray(payload.paragraphs));
    for (const parent of [record.publisherHTML,publisherBody,...publisherBody.querySelectorAll('div,section,article,main,header,footer,figure,figcaption')]) record.publisherTree.push([parent,[...parent.childNodes]]);
    record.publisherStyle = element('style'); record.publisherStyle.textContent = publisherTypography.compile(payload.publisherStyles,record.publisherRoot.id,record);
    record.publisherHasHeading = /^H[1-6]$/.test(record.blocks[0]?.tagName || '');
    const first = record.blocks[0];
    const normalizedHeading = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (first?.nodeType === 1 && /^H[1-6]$/.test(first.tagName) && normalizedHeading(first.textContent) === normalizedHeading(book.chapters[index]?.title || '第 ' + (index + 1) + ' 章')) {
      record.titleAnchors = [first, ...first.querySelectorAll('[data-wrp-anchor]')].map(node => node.dataset.wrpAnchor).filter(Boolean); record.blocks.shift();
    }
    // Remember just leading whitespace. Switching typography neither clones
    // paragraphs nor duplicates their text, and original indent remains recoverable.
    for (const block of record.blocks) {
      if (block.tagName !== 'P' || !block.textContent.trim() || block.querySelector('code,pre,.wrp-local-image-placeholder')) continue;
      const walker = doc.createTreeWalker(block, 4);
      let text;
      while ((text = walker.nextNode())) {
        const prefix = text.nodeValue.match(/^[\t \u00a0\u3000\r\n\ufeff]+/)?.[0] || '';
        if (prefix) record.leadingWhitespace.push([text,prefix]);
        if (text.nodeValue.length > prefix.length) break;
      }
      block.classList.add('wrp-local-prose');
    }
    record.paragraphs = record.blocks.flatMap(block => {
      const candidates = block.matches(blockSelector) ? [block, ...block.querySelectorAll(blockSelector)] : [...block.querySelectorAll(blockSelector)];
      const leaves = candidates.filter(node => !node.querySelector(blockSelector)); return leaves.length ? leaves : [block];
    });
    record.paragraphs.forEach((node, number) => { node.dataset.wrpParagraph = String(number); });
    return record;
  };
  const shuffledColors = index => {
    let seed = 2166136261;
    for (const character of String(book?.id || book?.title || '') + ':' + index) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    const order = colors.slice();
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return order;
  };
  const chapterButton = (index, text) => {
    const button = element('button', 'wrp-local-chapter-button', text); button.type = 'button';
    button.addEventListener('click', () => { void navigate(index); }); return button;
  };
  const renderRecord = record => {
    const {index, node, blocks} = record; node.replaceChildren();
    const publisher = publisherMode(), normalize = !publisher;
    if (record.whitespaceNormalized !== normalize) {
      for (const [text,prefix] of record.leadingWhitespace) text.nodeValue = normalize ? text.nodeValue.slice(prefix.length) : prefix + text.nodeValue;
      record.whitespaceNormalized = normalize;
    }
    for (const [,value,target] of record.publisherInline) { if (publisher) target.style.cssText = value; else target.removeAttribute("style"); }
    if (publisher) {
      for (const [parent,children] of record.publisherTree) parent.replaceChildren(...children);
      record.publisherRoot.replaceChildren(record.publisherStyle,record.publisherHTML);
    }
    if (!continuous() && index > 0) { const previous = element('nav', 'wrp-local-chapter-nav is-previous'); previous.append(chapterButton(index - 1, '上一章')); node.append(previous); }
    const literature = config.literature || {}, quotes = String(literature.english || '').split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
    // Literature cards keep EPUB title anchors without exposing the novel's
    // chapter heading above a reference-style card.
    const title = literature.enabled ? element('div', 'wrp-local-title-anchors') : element('h2', 'wrp-local-chapter-title', book.chapters[index]?.title || '第 ' + (index + 1) + ' 章');
    for (const anchor of record.titleAnchors) { const marker = element('span', 'wrp-local-anchor'); marker.dataset.wrpAnchor = anchor; title.append(marker); }
    if ((!literature.enabled || record.titleAnchors.length) && (!publisher || !record.publisherHasHeading)) node.append(title);
    if (literature.enabled) {
      const groupSize = Math.round(finite(literature.paragraphs, 3, 1, 20)), order = shuffledColors(index);
      for (let i = 0; i < blocks.length; i += groupSize) {
        const card = element('section', 'wrp-local-card'); card.style.setProperty('--wrp-local-card-accent', order[(i / groupSize) % order.length]);
        const header = element('div', 'wrp-local-card-header');
        const icon = element('span', 'wrp-local-card-icon', '☷'); icon.setAttribute('aria-hidden', 'true');
        header.append(icon, element('span', 'wrp-local-card-page', '第' + (Math.floor(i / groupSize) + 1) + '页 ↗'));
        const dots = element('span', 'wrp-local-card-dots', '···'); dots.setAttribute('aria-hidden', 'true'); header.append(dots); card.append(header);
        if (quotes.length) { const quote = element('div', 'wrp-local-card-quote'); quote.append(element('p', '', quotes[(i / groupSize) % quotes.length])); card.append(quote); }
        const body = element('div', 'wrp-local-card-body'); for (const block of blocks.slice(i, i + groupSize)) body.append(block); card.append(body); node.append(card);
      }
    } else if (publisher) node.append(record.publisherRoot);
    else for (const block of blocks) node.append(block);
    if (!blocks.length) node.append(element('p', 'wrp-local-empty-chapter', '这一章没有文字内容。'));
    if (!continuous() && index < book.chapters.length - 1) { const next = element('nav', 'wrp-local-chapter-nav is-next'); next.append(chapterButton(index + 1, '下一章')); node.append(next); }
    else if (index === book.chapters.length - 1) node.append(element('p', 'wrp-local-book-end', '已读到本书末尾'));
  };
  const sortedRecords = () => [...records.values()].sort((a, b) => a.index - b.index);
  const renderBody = () => {
    content.replaceChildren(); root.classList.toggle('is-literature', !!config.literature?.enabled); root.classList.toggle('is-continuous', continuous()); root.classList.toggle('is-publisher', publisherMode());
    if (!book || chapter < 0) { welcome(); return; }
    for (const record of sortedRecords()) { renderRecord(record); content.append(record.node); }
  };

  const paragraphTop = node => node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
  const selectChapter = index => { if (chapter !== index) { chapter = index; invoke('onChapter', chapter); } };
  const visibleRecord = () => {
    const mounted = sortedRecords(); if (!mounted.length) return null;
    let result = mounted[0];
    for (const record of mounted) { if (paragraphTop(record.node) > scroll.scrollTop + 8) break; result = record; }
    return result;
  };
  const captureProgress = () => {
    if (pendingRestore) return {...pendingRestore};
    if (deferredRestore) {
      const anchor = {...deferredRestore}, record = records.get(anchor.chapter);
      if (!book || !scroll.clientHeight || !record?.node.getBoundingClientRect().height) return anchor;
      restoreProgress(anchor); return {...remembered};
    }
    if (!book || chapter < 0 || !scroll.clientHeight) return {...remembered};
    const record = continuous() ? visibleRecord() : records.get(chapter); if (!record) return {...remembered};
    selectChapter(record.index);
    const paragraphs = record.paragraphs;
    let index = 0, low = 0, high = paragraphs.length - 1;
    while (low <= high) { const middle = Math.floor((low + high) / 2); if (paragraphTop(paragraphs[middle]) <= scroll.scrollTop + 8) { index = middle; low = middle + 1; } else high = middle - 1; }
    const node = paragraphs[index];
    const offset = node ? finite((scroll.scrollTop - paragraphTop(node)) / Math.max(1, node.getBoundingClientRect().height), 0, 0, 1) : 0;
    const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const start = continuous() ? paragraphTop(record.node) : 0;
    const length = continuous() ? record.node.getBoundingClientRect().height : extent;
    const atEnd = record.index === book.chapters.length - 1 && scroll.scrollTop >= extent - 3;
    const fraction = atEnd ? 1 : length ? finite((scroll.scrollTop - start) / length, 0, 0, 1) : 1;
    remembered = {chapter:record.index, paragraph:index, offset, percent:Math.round(((record.index + fraction) / book.chapters.length) * 10000) / 100};
    return {...remembered};
  };
  const restoreProgress = progress => {
    if (!book || chapter < 0) return;
    const record = records.get(Number(progress?.chapter)) || records.get(chapter); if (!record) return;
    const index = Math.round(finite(progress?.paragraph, 0, 0, Math.max(0, record.paragraphs.length - 1))), node = record.paragraphs[index], offset = finite(progress?.offset, 0, 0, 1);
    if (!scroll.clientHeight || !record.node.getBoundingClientRect().height) {
      deferredRestore = {...progress,chapter:record.index,paragraph:index,offset};
      chapter = record.index; remembered = {...remembered,...deferredRestore}; return;
    }
    deferredRestore = null;
    if (continuous() && record.node.getBoundingClientRect().height < scroll.clientHeight) {
      shortWindow = true;
      for (const old of [...records.values()]) if (old.index < record.index) releaseRecord(old);
    }
    scroll.scrollTop = node && (index > 0 || offset > 0) ? Math.max(0, paragraphTop(node) + offset * node.getBoundingClientRect().height) : Math.max(0, continuous() ? paragraphTop(record.node) : 0);
    chapter = record.index; remembered = {...remembered, ...progress, chapter, paragraph:index, offset};
  };
  const queueRestore = progress => {
    if (frame != null) cancelFrame(frame);
    pendingRestore = {...progress}; const currentGeneration = generation;
    frame = requestFrame(() => { frame = null; const anchor = pendingRestore; pendingRestore = null; if (!disposed && generation === currentGeneration) { restoreProgress(anchor); scheduleWindow(); } });
  };
  const clearQueuedRestore = restore => {
    if (frame != null) cancelFrame(frame); frame = null;
    const anchor = pendingRestore; pendingRestore = null; if (restore && anchor) restoreProgress(anchor);
  };
  const emitProgress = () => {
    if (progressTimer != null) clearTimeout(progressTimer); progressTimer = null;
    if (!disposed && book && chapter >= 0) invoke('onProgress', captureProgress());
  };
  const scrollToAnchor = (anchor, index = chapter) => {
    if (!anchor) return false;
    const record = records.get(index); if (!record) return false;
    const node = [...record.node.querySelectorAll('[data-wrp-anchor]')].find(item => item.dataset.wrpAnchor === anchor);
    if (!node) return false;
    scroll.scrollTop = Math.max(0, paragraphTop(node) - (node.closest('.wrp-local-title-anchors') ? 0 : 8)); captureProgress(); return true;
  };
  const loadImages = (record, token) => {
    if (record.imageTask && record.imageToken === token) return record.imageTask;
    record.imageToken = token;
    const currentBook = book;
    const run = async () => {
      for (const request of record.images) {
        if (request.loaded) continue;
        if (disposed || generation !== token || currentBook !== book || !record.alive) return;
        try {
          const resource = await currentBook.readResource(request.href, record.index);
          if (disposed || generation !== token || currentBook !== book || !record.alive) return;
          request.loaded = true;
          if (!resource || !/^image\/(?:png|jpeg|gif|webp|avif|bmp)$/i.test(resource.mime || '')) continue;
          const size = resource.data?.byteLength ?? resource.data?.size ?? 0;
          if (!size || size > 8 * 1024 * 1024 || imageBytes + size > 24 * 1024 * 1024 || !view?.URL?.createObjectURL) continue;
          const progress = captureProgress(), blob = new view.Blob([resource.data], {type:resource.mime});
          const url = view.URL.createObjectURL(blob); record.resources.set(url, size); imageBytes += size;
          const image = element('img', 'wrp-local-image'); if(request.holder.dataset.wrpAnchor)image.dataset.wrpAnchor=request.holder.dataset.wrpAnchor; publisherTypography.attributes(request.publisherAttributes,image,record);
          if (publisherMode()) { const inline = record.publisherInline.find(value=>value[2]===image); if(inline)image.style.cssText=inline[1]; }
          image.alt = request.alt; image.decoding = 'async'; image.loading = 'lazy';
          image.addEventListener('load', () => { if (generation === token && !disposed && record.alive) queueRestore({...remembered}); }, {once:true});
          image.src = url; request.holder.replaceWith(image); queueRestore(progress);
        } catch (_) { /* Unsupported assets keep a readable alt-text placeholder. */ }
      }
    };
    const task = run().finally(() => { if (record.imageTask === task) record.imageTask = null; }); record.imageTask = task; return task;
  };
  const readRecord = async (index, token, currentBook) => {
    pendingChapterReads++;
    let payload;
    try { payload = await currentBook.readChapter(index); } finally { pendingChapterReads--; }
    if (disposed || generation !== token || currentBook !== book) return null;
    return makeRecord(payload, index);
  };
  const keepWindow = center => {
    for (const record of [...records.values()]) if (Math.abs(record.index - center) > 1) releaseRecord(record);
  };
  const extendWindow = async (token, currentBook) => {
    do {
      windowDirty = false;
      if (disposed || token !== generation || currentBook !== book || !continuous()) return;
      clearQueuedRestore(true);
      const progress = captureProgress(); keepWindow(progress.chapter); restoreProgress(progress);
      // Forward comes first, so reaching the next chapter needs no reload.
      if (shortWindow && records.get(progress.chapter)?.node.getBoundingClientRect().height >= scroll.clientHeight) shortWindow = false;
      for (const index of shortWindow ? [progress.chapter + 1] : [progress.chapter + 1, progress.chapter - 1]) {
        if (index < 0 || index >= currentBook.chapters.length || records.has(index) || failedAdjacent.has(index)) continue;
        let record;
        try { record = await readRecord(index, token, currentBook); }
        catch (error) {
          if (token === generation && currentBook === book && !disposed) { failedAdjacent.add(index); showStatus(error?.message || '相邻章节暂时无法读取。', true); invoke('onError', error?.message || '相邻章节暂时无法读取。'); }
          continue;
        }
        if (!record) return;
        clearQueuedRestore(true);
        const anchor = captureProgress();
        if (!continuous() || Math.abs(record.index - anchor.chapter) > 1) { record.alive = false; windowDirty = true; continue; }
        if (shortWindow && record.index < anchor.chapter) { record.alive = false; continue; }
        keepWindow(anchor.chapter);
        if (!records.has(record.index)) {
          records.set(record.index, record); renderRecord(record);
          const following = sortedRecords().find(item => item.index > record.index); content.insertBefore(record.node, following?.node || null);
          maxRenderedChapters = Math.max(maxRenderedChapters, records.size);
          restoreProgress(anchor); void loadImages(record, token);
        }
      }
      const current = captureProgress();
      if (current.chapter !== progress.chapter) windowDirty = true;
    } while (windowDirty);
  };
  const scheduleWindow = () => {
    if (disposed || !book || chapter < 0 || !continuous()) return;
    if (windowTask?.token === generation) { windowDirty = true; return; }
    if (maintenanceFrame != null) return;
    const token = generation, currentBook = book;
    maintenanceFrame = requestFrame(() => {
      maintenanceFrame = null;
      if (disposed || token !== generation || currentBook !== book || !continuous()) return;
      const handle = {token, promise:null}; windowTask = handle;
      handle.promise = extendWindow(token, currentBook).finally(() => { if (windowTask === handle) { windowTask = null; if (windowDirty) scheduleWindow(); } });
    });
  };
  const cancelMaintenance = () => {
    if (maintenanceFrame != null) cancelFrame(maintenanceFrame); maintenanceFrame = null; windowDirty = false; failedAdjacent.clear(); shortAdvance = null;
  };
  const onScroll = () => {
    if (!book || chapter < 0 || pendingRestore) return;
    captureProgress(); scheduleWindow();
    if (progressTimer != null) clearTimeout(progressTimer); progressTimer = setTimeout(emitProgress, 180);
  };
  const closeCatalog = () => { if (catalog) { catalog.remove(); catalog = null; } };
  const updateGutter = () => {
    const desired = publisherMode() ? 8 : finite(config.contentPadding, 16, 4, 320);
    // Fractional host dimensions must reach both card borders unchanged.
    const available = content.getBoundingClientRect().width || scroll.clientWidth || root.clientWidth;
    const maximum = available > 0 ? Math.max(4, (available - 80) / 2) : 320;
    let left = Math.min(desired, maximum), right = left;
    const bounds = config.literature?.enabled ? config.literature.dockBounds : null;
    if (available > 0 && Number.isFinite(bounds?.left) && Number.isFinite(bounds?.right) && bounds.right > bounds.left) {
      left = Math.max(0, Math.min(bounds.left, Math.max(0, available - 80)));
      const edge = Math.max(Math.min(available, left + 80), Math.min(available, bounds.right)); right = Math.max(0, available - edge);
    }
    root.style.setProperty('--wrp-local-gutter', Math.min(desired, maximum) + 'px'); root.style.setProperty('--wrp-local-gutter-left', left + 'px'); root.style.setProperty('--wrp-local-gutter-right', right + 'px');
  };
  const navigate = async (index, anchor, progress) => {
    if (disposed || !book || !book.chapters.length) return false;
    clearQueuedRestore(true);
    index = Math.round(finite(index, chapter < 0 ? 0 : chapter, 0, book.chapters.length - 1)); closeCatalog();
    const existing = records.get(index);
    if (existing && !progress) {
      selectChapter(index);
      if (anchor === '__wrp_end__') scroll.scrollTop = paragraphTop(existing.node) + existing.node.getBoundingClientRect().height - scroll.clientHeight;
      else if (!scrollToAnchor(anchor, index)) restoreProgress({chapter:index,paragraph:0,offset:0});
      emitProgress(); scheduleWindow(); return true;
    }
    if (chapter >= 0) emitProgress();
    const token = ++generation, currentBook = book; deferredRestore = null; cancelMaintenance(); showStatus('正在打开章节…');
    try {
      const record = await readRecord(index, token, currentBook);
      if (!record) return false;
      releaseResources(); chapter = index; records.set(index, record); maxRenderedChapters = Math.max(maxRenderedChapters, records.size); renderBody(); shortWindow = continuous() && record.node.getBoundingClientRect().height < scroll.clientHeight;
      remembered = {chapter, paragraph:0, offset:0, percent:Math.round((chapter / book.chapters.length) * 10000) / 100}; showStatus('');
      if (anchor === '__wrp_end__') scroll.scrollTop = scroll.scrollHeight;
      else if (!scrollToAnchor(anchor, index)) restoreProgress(progress || remembered);
      queueRestore(captureProgress()); invoke('onChapter', chapter); emitProgress(); void loadImages(record, token); scheduleWindow(); return true;
    } catch (error) {
      if (disposed || token !== generation || currentBook !== book) return false;
      const message = error?.message || '章节打开失败，请重新选择图书。'; showStatus(message, true); invoke('onError', message); return false;
    }
  };
  const setBook = async (nextBook, progress) => {
    if (disposed) return false;
    if (book && chapter >= 0) emitProgress(); clearQueuedRestore(false); cancelMaintenance();
    ++generation; ++bookRevision; chapterNavigation = Promise.resolve(); releaseResources(); closeCatalog(); book = nextBook || null; chapter = -1; maxRenderedChapters = 0; shortWindow = false; deferredRestore = null;
    remembered = {chapter:0, paragraph:0, offset:0, percent:0}; content.replaceChildren(); scroll.scrollTop = 0;
    if (!book) { showStatus(''); welcome(); return true; }
    if (!Array.isArray(book.chapters) || !book.chapters.length || typeof book.readChapter !== 'function') { const message = '这本书没有可读取的章节。'; showStatus(message, true); invoke('onError', message); return false; }
    return navigate(progress?.chapter || 0, null, progress);
  };

  const applyAppearance = next => {
    if (disposed) return;
    const progress = captureProgress(), wasContinuous = continuous(), oldLiterature = config.literature || {}, literature = next.literature || {};
    const regroup = config.localTypography !== next.localTypography || oldLiterature.enabled !== literature.enabled || oldLiterature.english !== literature.english || oldLiterature.paragraphs !== literature.paragraphs;
    config = {...next, literature:{...literature}};
    const palette = next.palette || {};
    for (const name of ['primary','secondary','border','text','muted','faint']) { const value = palette[name]; if (typeof value === 'string' && value) root.style.setProperty('--wrp-local-' + name, value); else root.style.removeProperty('--wrp-local-' + name); }
    root.style.setProperty('--wrp-local-font-size', finite(next.fontSize ?? next.fontSizePx, 16, 8, 72) + 'px');
    root.style.setProperty('--wrp-local-line-height', String(finite(next.lineHeight, 1.9, 1, 4)));
    root.style.setProperty('--wrp-local-paragraph-spacing', finite(next.paragraphSpacing, 0, 0, 120) + 'px'); updateGutter();
    const family = literature.enabled && literature.fontFamily ? literature.fontFamily : next.fontFamily;
    if (typeof family === 'string' && family.trim()) root.style.fontFamily = family; else root.style.removeProperty('font-family');
    root.dataset.wrpReadingFlow = next.readingFlow === 'paged' && !literature.enabled ? 'paged' : 'scroll';
    if (wasContinuous !== continuous() && book && chapter >= 0) {
      clearQueuedRestore(false); ++generation; cancelMaintenance();
      if (!continuous()) for (const record of [...records.values()]) if (record.index !== progress.chapter) releaseRecord(record);
      chapter = progress.chapter; renderBody();
      for (const record of records.values()) void loadImages(record, generation);
    } else if (regroup && book && chapter >= 0) renderBody();
    root.classList.toggle('is-literature', !!literature.enabled); root.classList.toggle('is-continuous', continuous()); root.classList.toggle('is-publisher', publisherMode());
    if (continuous() && book && records.has(progress.chapter)) {
      // Appearance can first be supplied after setBook, or shrink a chapter
      // beneath the viewport. Prepending then clamps scrollTop into the prior
      // chapter; keep the restored chapter first until it can hold an anchor.
      shortWindow = records.get(progress.chapter).node.getBoundingClientRect().height < scroll.clientHeight;
      if (shortWindow) for (const record of [...records.values()]) if (record.index < progress.chapter) releaseRecord(record);
    }
    queueRestore(progress);
  };
  const turn = async direction => {
    if (!book || chapter < 0 || disposed) return false;
    clearQueuedRestore(true); direction = direction < 0 ? -1 : 1;
    const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    if (!continuous()) {
      if (direction > 0 && scroll.scrollTop >= extent - 3 && chapter < book.chapters.length - 1) return navigate(chapter + 1);
      if (direction < 0 && scroll.scrollTop <= 3 && chapter > 0) return navigate(chapter - 1, '__wrp_end__');
    }
    if (continuous() && ((direction > 0 && scroll.scrollTop >= extent - 1 && chapter < book.chapters.length - 1) || (direction < 0 && scroll.scrollTop <= 1 && sortedRecords()[0]?.index > 0))) { await advanceShortWindow(direction); return true; }
    scroll.scrollTop = Math.max(0, Math.min(extent, scroll.scrollTop + direction * Math.max(40, scroll.clientHeight * 0.88)));
    emitProgress(); scheduleWindow(); return true;
  };
  const scrollLineHeight = () => {
    const configured = finite(config.fontSize ?? config.fontSizePx, 16, 8, 72) * finite(config.lineHeight, 1.9, 1, 4);
    if (!publisherMode() || !view?.getComputedStyle) return configured;
    const progress = captureProgress(), record = records.get(progress.chapter);
    const node = record?.paragraphs[progress.paragraph] || record?.paragraphs.find(item => item.classList.contains('wrp-local-prose'));
    if (!node) return configured;
    const style = view.getComputedStyle(node), height = parseFloat(style.lineHeight);
    if (Number.isFinite(height) && height > 0) return height;
    // CSS 'normal' has no numeric computed value. Text-line positions expose
    // its actual advance without inserting a measuring node into the chapter.
    try {
      const range = doc.createRange(); range.selectNodeContents(node);
      const tops = [...range.getClientRects()].filter(rect => rect.height > 0 && rect.width > 0).map(rect => rect.top).sort((a, b) => a - b);
      const size = parseFloat(style.fontSize) || 16, lines = [];
      for (const top of tops) if (!lines.length || top - lines[lines.length - 1] > size * 0.5) lines.push(top);
      if (lines.length > 1) return (lines[lines.length - 1] - lines[0]) / (lines.length - 1);
      const single = node.getBoundingClientRect().height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0) - (parseFloat(style.borderTopWidth) || 0) - (parseFloat(style.borderBottomWidth) || 0);
      if (lines.length === 1 && single > 0) return single;
      return size * 1.2;
    } catch (_) { return configured; }
  };
  const scrollByDirection = async direction => {
    if (!book || chapter < 0 || disposed || !Number.isFinite(Number(direction)) || Number(direction) === 0) return false;
    clearQueuedRestore(true); direction = Number(direction) < 0 ? -1 : 1;
    if (root.dataset.wrpReadingFlow === 'paged') return turn(direction);
    const before = captureProgress(), previousTop = scroll.scrollTop;
    const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    if (continuous() && ((direction > 0 && previousTop >= extent - 1 && before.chapter < book.chapters.length - 1) || (direction < 0 && previousTop <= 1 && sortedRecords()[0]?.index > 0))) {
      await advanceShortWindow(direction);
      return !disposed && (captureProgress().chapter !== before.chapter || scroll.scrollTop !== previousTop);
    }
    scroll.scrollTop = Math.max(0, Math.min(extent, previousTop + direction * scrollLineHeight() * 3));
    emitProgress(); scheduleWindow(); return Math.abs(scroll.scrollTop - previousTop) > 0.1;
  };
  const navigateChapter = direction => {
    if (!book || chapter < 0 || disposed || !Number.isFinite(Number(direction)) || Number(direction) === 0) return Promise.resolve(false);
    direction = Number(direction) < 0 ? -1 : 1;
    const currentBook = book, revision = bookRevision;
    // Each key press starts from the chapter visible after the previous press.
    // Serializing prevents slow EPUB reads from skipping or overwriting a turn.
    const task = chapterNavigation.then(async () => {
      if (disposed || book !== currentBook || revision !== bookRevision) return false;
      clearQueuedRestore(true);
      const index = captureProgress().chapter + direction;
      if (index < 0 || index >= currentBook.chapters.length) return false;
      return navigate(index);
    });
    chapterNavigation = task.catch(() => false); return task;
  };
  const openCatalog = () => {
    if (disposed || !book) return;
    if (catalog) { closeCatalog(); return; }
    catalog = element('div', 'wrp-local-catalog'); catalog.setAttribute('role', 'dialog'); catalog.setAttribute('aria-label', '章节目录');
    const header = element('div', 'wrp-local-catalog-header'); header.append(element('strong', '', '章节目录'));
    const close = element('button', 'wrp-local-catalog-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭目录'); close.addEventListener('click', closeCatalog); header.append(close);
    const search = element('input', 'wrp-local-catalog-search'); search.type = 'search'; search.placeholder = '搜索章节'; search.setAttribute('aria-label', '搜索章节');
    const list = element('div', 'wrp-local-catalog-list');
    const navigation = Array.isArray(book.navigation) && book.navigation.length ? book.navigation : book.chapters.map((item, index) => ({title:item.title, chapterIndex:index}));
    const renderList = () => {
      list.replaceChildren(); const query = search.value.trim().toLocaleLowerCase();
      for (const item of navigation) {
        const title = String(item.title || '第 ' + (item.chapterIndex + 1) + ' 章');
        if (query && !title.toLocaleLowerCase().includes(query)) continue;
        if (!Number.isInteger(item.chapterIndex) || item.chapterIndex < 0 || item.chapterIndex >= book.chapters.length) continue;
        const button = element('button', 'wrp-local-catalog-item', title); button.type = 'button'; button.classList.toggle('is-active', item.chapterIndex === chapter);
        if (item.chapterIndex === chapter) button.setAttribute('aria-current', 'true'); button.addEventListener('click', () => { void navigate(item.chapterIndex, item.anchor); }); list.append(button);
      }
      if (!list.childElementCount) list.append(element('p', 'wrp-local-catalog-empty', '没有匹配的章节'));
    };
    search.addEventListener('input', renderList); renderList(); catalog.append(header, search, list); root.append(catalog);
    list.querySelector('.is-active')?.scrollIntoView({block:'nearest'}); search.focus();
  };
  const onClick = event => {
    const link = event.target?.closest?.('[data-wrp-local-href]'); if (!link || !root.contains(link) || !book) return;
    event.preventDefault(); const record = records.get(Number(link.closest('[data-wrp-chapter]')?.dataset.wrpChapter));
    const target = safePath(link.dataset.wrpLocalHref, record?.href); if (!target) return;
    const index = book.chapters.findIndex(item => chapterPath(item) === target.path);
    if (index >= 0) void navigate(index, target.anchor);
    else if (target.path === (safePath(record?.href, '')?.path || '')) scrollToAnchor(target.anchor, record.index);
  };
  const onKeyDown = event => {
    if (event.key === 'Escape' && catalog) { event.preventDefault(); closeCatalog(); root.focus(); return; }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable) return;
    const direction = ['ArrowRight','PageDown'].includes(event.key) ? 1 : ['ArrowLeft','PageUp'].includes(event.key) ? -1 : 0;
    if (direction) { event.preventDefault(); void turn(direction); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); clearQueuedRestore(true); scroll.scrollTop += (event.key === 'ArrowDown' ? 1 : -1) * finite(config.fontSize ?? config.fontSizePx, 16, 8, 72) * finite(config.lineHeight, 1.9, 1, 4); scheduleWindow(); }
  };
  const onPointerDown = event => { if (event.target?.closest?.('button,a,input,textarea,select,[contenteditable="true"]')) return; clearQueuedRestore(true); root.focus({preventScroll:true}); };
  const advanceShortWindow = async direction => {
    if (shortAdvance || disposed || !book || !continuous()) return;
    const mounted = sortedRecords(), currentBook = book, token = generation;
    const progress = captureProgress();
    const index = direction > 0 ? progress.chapter + 1 : (mounted[0]?.index ?? progress.chapter) - 1;
    if (index < 0 || index >= currentBook.chapters.length || (direction > 0 && index <= progress.chapter)) { scheduleWindow(); return; }
    const handle = {}; shortAdvance = handle;
    try {
      let record = records.get(index);
      if (!record) record = await readRecord(index, token, currentBook);
      if (!record || disposed || token !== generation || currentBook !== book || !continuous()) return;
      clearQueuedRestore(false);
      for (const old of [...records.values()]) if (old.index < index || old.index > index + 1) releaseRecord(old);
      records.set(index, record); chapter = index; shortWindow = true;
      maxRenderedChapters = Math.max(maxRenderedChapters, records.size); renderBody();
      remembered = {chapter:index,paragraph:0,offset:0,percent:Math.round(index / book.chapters.length * 10000) / 100};
      scroll.scrollTop = direction < 0 ? Math.max(0, record.node.getBoundingClientRect().height - scroll.clientHeight) : 0;
      invoke('onChapter', index); emitProgress(); void loadImages(record, token); scheduleWindow();
    } catch (error) {
      if (!disposed && token === generation && currentBook === book) { showStatus(error?.message || '相邻章节暂时无法读取。', true); invoke('onError', error?.message || '相邻章节暂时无法读取。'); }
    } finally { if (shortAdvance === handle) shortAdvance = null; }
  };
  const onWheel = event => {
    if (!catalog && pendingRestore) clearQueuedRestore(true);
    if (!book || chapter < 0 || event.ctrlKey || catalog) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX; if (!delta) return;
    if (continuous()) {
      const extent = Math.max(0, scroll.scrollHeight - scroll.clientHeight), mounted = sortedRecords();
      const atForwardBoundary = delta > 0 && scroll.scrollTop >= extent - 1 && captureProgress().chapter < book.chapters.length - 1;
      const atBackBoundary = delta < 0 && scroll.scrollTop <= 1 && mounted[0]?.index > 0;
      if (atForwardBoundary || atBackBoundary) { event.preventDefault(); void advanceShortWindow(delta < 0 ? -1 : 1); }
      return;
    }
    if (root.dataset.wrpReadingFlow !== 'paged') return;
    event.preventDefault(); const now = Date.now(); if (now - lastWheelTurn < 280) return; lastWheelTurn = now; void turn(delta < 0 ? -1 : 1);
  };
  scroll.addEventListener('scroll', onScroll, {passive:true}); scroll.addEventListener('wheel', onWheel, {passive:false});
  root.addEventListener('click', onClick); root.addEventListener('keydown', onKeyDown); root.addEventListener('pointerdown', onPointerDown);
  const resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(() => {
    if (disposed) return; invoke('onResize'); updateGutter(); if (book && scroll.clientHeight) queueRestore(pendingRestore || {...remembered});
  }) : null;
  resizeObserver?.observe(scroll); welcome();
  return {
    setBook, applyAppearance, navigate, turn, scrollByDirection, navigateChapter, captureProgress, openCatalog,
    preserveProgress() { if (!disposed && book && records.size) queueRestore(captureProgress()); },
    destroy() {
      if (disposed) return; emitProgress(); disposed = true; ++generation; ++bookRevision;
      if (progressTimer != null) clearTimeout(progressTimer); clearQueuedRestore(false); cancelMaintenance();
      resizeObserver?.disconnect(); releaseResources(); closeCatalog(); scroll.removeEventListener('scroll', onScroll); scroll.removeEventListener('wheel', onWheel);
      root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKeyDown); root.removeEventListener('pointerdown', onPointerDown); root.remove(); book = null; deferredRestore = null;
    },
    get root() { return root; },
    get book() { return book; },
    get chapter() { return chapter; },
    get stats() { return {renderedChapters:records.size, maxRenderedChapters, maxChapters, chapterIndexes:sortedRecords().map(record => record.index), imageBytes, pendingChapterReads, awaitingLayout:!!deferredRestore, continuous:continuous()}; }
  };
});
const installLocalBooks = (function installLocalBooks(Pocket, dependencies) {
  const {Modal, Setting, Notice, Menu, createLocalBookStore, createLocalReaderSurface} = dependencies;
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
  function normalizeLibrary(settings) {
    initializeNode();
    const seen = new Set();
    settings.localBooks = (Array.isArray(settings.localBooks) ? settings.localBooks : []).filter(entry => entry && typeof entry.path==='string' && supported.test(entry.path) && entry.path.length<32768).map(entry => {
      const id = preserveId(entry.id,entry.path), key=canonical(entry.path);
      if(seen.has(key)) return null;
      seen.add(key);
      return {id,path:entry.path,sourcePath:typeof entry.sourcePath==='string'&&supported.test(entry.sourcePath)&&entry.sourcePath.length<32768?entry.sourcePath:'',title:String(entry.title||require('path').basename(entry.path)).slice(0,240),author:String(entry.author||'').slice(0,240),format:/\.epub$/i.test(entry.path)?'EPUB':'TXT',addedAt:Number(entry.addedAt)||Date.now(),lastOpened:Number(entry.lastOpened)||0,progress:progressOf(entry.progress)};
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
    this.captureLocalProgress();this.localOpenRevision++;this.localOpening=false;
    const reader=this.localReader,books=[this.localBook,this.localPendingPreviousBook];
    this.localReader=null;this.localBook=null;this.localEntry=null;this.localPendingPreviousBook=null;
    this.localReaderCleanup?.();this.localReaderCleanup=null;reader?.destroy();
    this.nativeFontReady=false;
    for(const book of books)void this.closeLocalBook(book);
  };
  Pocket.prototype.updateLocalSourceVisibility=function(){this.readingSurface?.setAttribute('data-wrp-source',this.isLocalSource()?'local':'weread');};
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
  wrap('hide',function(base,...args){this.captureLocalProgress();return base.apply(this,args);});
  wrap('updateShortcutHints',function(base,...args){const result=base.apply(this,args);this.updateLocalHeader();return result;});
  wrap('onunload',function(base,...args){this.captureLocalProgress();if(this.localEntry&&!this.__wrpValidationPersist)void this.saveData(this.settings).catch(()=>{});this.localFileOpenRevision=(this.localFileOpenRevision||0)+1;this.releaseLocalSource();this.localShelfModal?.close();return base.apply(this,args);});
  return {normalizeLibrary,progressOf,idFor,libraryFolder,isManagedRelative,inside,libraryContext};
});
const localBookTools = installLocalBooks(Pocket,{Modal,Setting,Notice,Menu,createLocalBookStore,createLocalReaderSurface,matchesHotkey,FONT_SIZES});
// WRP_LOCAL_BOOKS_END
module.exports=Pocket;
module.exports._test={officialUrl,bookmarkUrl,fitRect,normalizedLayoutProfiles,normalizedCardProfiles,normalizedLiteratureLocations,normalizedUnderlineProfiles,cardDefaults,matchesHotkey,officialReaderNavigation,READER_NAVIGATION_COMMANDS,COMMAND_HOTKEYS,localBookTools,createLocalBookStore,createLocalReaderSurface};
