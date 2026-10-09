// A small Markdown renderer for the helper's prompt: headings, nested lists, paragraphs, code, bold, inline code.
// Builds DOM nodes (no innerHTML), so text from the data repo can't inject anything.

function inline(text) {
  const frag = document.createDocumentFragment();
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const t = m[0];
    const node = document.createElement(t.startsWith('**') ? 'strong' : 'code');
    node.textContent = t.startsWith('**') ? t.slice(2, -2) : t.slice(1, -1);
    frag.append(node);
    last = m.index + t.length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export function renderMarkdown(md) {
  const root = document.createElement('div');
  root.className = 'md';
  const lines = String(md).replace(/\r/g, '').split('\n');
  let para = null;
  const stack = [];   // open lists: { indent, el, last }
  const closeLists = (indent = -1) => { while (stack.length && stack.at(-1).indent > indent) stack.pop(); };
  const flush = () => { para = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush(); closeLists();
      const pre = document.createElement('pre');
      const body = [];
      while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
      pre.textContent = body.join('\n');
      root.append(pre);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush(); closeLists();
      const el = document.createElement(`h${Math.min(6, h[1].length + 2)}`);
      el.append(inline(h[2]));
      root.append(el);
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      const indent = li[1].length, ordered = /\d/.test(li[2]);
      closeLists(indent);
      let top = stack.at(-1);
      if (!top || top.indent < indent) {
        const list = document.createElement(ordered ? 'ol' : 'ul');
        if (ordered) list.start = Number(li[2]);
        (top?.last ?? root).append(list);
        top = { indent, el: list, last: null };
        stack.push(top);
      }
      const item = document.createElement('li');
      item.append(inline(li[3]));
      top.el.append(item);
      top.last = item;
      continue;
    }
    // A plain line: continues a list item when indented under one, else a paragraph.
    if (stack.length && /^\s+/.test(line) && stack.at(-1).last) {
      stack.at(-1).last.append(' ', inline(line.trim()));
      continue;
    }
    closeLists();
    if (!para) { para = document.createElement('p'); root.append(para); }
    else para.append(' ');
    para.append(inline(line.trim()));
  }
  return root;
}

// The numbered steps under "## Steps": [{ n, title, body }] (body is the step's own Markdown).
export function promptSteps(md) {
  const text = String(md).replace(/\r/g, '');
  const start = text.search(/^## Steps\s*$/m);
  if (start < 0) return { steps: [], after: '' };
  const lines = text.slice(start).split('\n').slice(1);
  const steps = [];
  let after = [];
  for (const line of lines) {
    if (/^## /.test(line)) break;
    const m = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)$/);
    if (m) { steps.push({ n: Number(m[1]), title: m[2].replace(/\.$/, ''), body: [m[3]] }); continue; }
    if (steps.length && (/^\s/.test(line) || !line.trim()) && !after.length) { steps.at(-1).body.push(line.replace(/^ {3}/, '')); continue; }
    if (line.trim()) after.push(line);
  }
  return { steps: steps.map((s) => ({ ...s, body: s.body.join('\n').trim() })), after: after.join('\n').trim() };
}
