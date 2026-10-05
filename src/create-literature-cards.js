function createLiteratureCards({ reader, chapterKey, getParagraphSpacing, getConfig, eventDocument = document }) {
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
}
