/** Text snapshots and line changes. Shared by the CLI and the n8n Code node. */
export const EXTRACTOR_VERSION = 1;

export function validatePage(page) {
  if (!page || typeof page !== 'object' || typeof page.url !== 'string') throw new Error('A page requires a URL');
  if (/[\s\\\u0000-\u001f\u007f]/.test(page.url)) throw new Error('URL contains whitespace or a control character');
  const match = /^https:\/\/([^/?#]+)([^#]*)(?:#.*)?$/i.exec(page.url);
  if (!match) throw new Error('Use a public HTTPS URL');
  const authority = match[1].toLowerCase();
  const host = authority.replace(/:443$/, '').replace(/\.$/, '');
  const labels = host.split('.');
  if (authority.includes('@') || host.includes(':') || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels.at(-1))) throw new Error('Use a public hostname on port 443 without credentials');
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) throw new Error('Local hostnames are not supported');
  const suffix = match[2] || '/';
  const canonical = 'https://' + host + (suffix.startsWith('?') ? '/' + suffix : suffix);
  for (const field of ['include', 'ignore']) {
    if (page[field] !== undefined && (!Array.isArray(page[field]) || page[field].some(s => typeof s !== 'string' || !s.trim()))) throw new Error(field + ' must be an array of non-empty strings');
  }
  return {name: String(page.name || host), url: canonical, include: page.include || [], ignore: page.ignore || []};
}

export function decodeEntities(text) {
  const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...'};
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, token) => {
    if (token[0] !== '#') return named[token.toLowerCase()] ?? match;
    const code = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  });
}

export function extractLines(html, page) {
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Expected a text response no larger than 2 MB');
  let text = html.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  text = text.replace(/<\/?(?:p|div|h[1-6]|li|tr|section|article|header|footer|nav|main|br|hr)\b[^>]*>/gi, '\n');
  text = decodeEntities(text.replace(/<[^>]*>/g, ' '));
  const include = page.include.map(s => s.toLowerCase());
  const ignore = page.ignore.map(s => s.toLowerCase());
  const lines = text.split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .filter(s => (!include.length || include.some(term => s.toLowerCase().includes(term))) && !ignore.some(term => s.toLowerCase().includes(term)));
  if (!lines.length) throw new Error('No matching text; the previous snapshot was kept');
  if (lines.length > 5000 || lines.join('\n').length > 100000) throw new Error('Selected text is too large; narrow the include filters');
  return lines;
}

export function pageKey(page) {
  return JSON.stringify([EXTRACTOR_VERSION, page.url, [...page.include].sort(), [...page.ignore].sort()]);
}

export function lineDiff(before, after) {
  const subtract = (left, right) => {
    const counts = new Map();
    for (const line of right) counts.set(line, (counts.get(line) || 0) + 1);
    return left.filter(line => { const n = counts.get(line) || 0; if (n) { counts.set(line, n - 1); return false; } return true; });
  };
  return {added: subtract(after, before), removed: subtract(before, after)};
}

export function comparePage(state, rawPage, html, checkedAt) {
  const page = validatePage(rawPage);
  const lines = extractLines(html, page);
  const key = pageKey(page);
  const previous = state[key];
  const diff = previous ? lineDiff(previous.lines, lines) : {added: [], removed: []};
  const status = !previous ? 'baseline' : diff.added.length || diff.removed.length ? 'changed' : 'unchanged';
  state[key] = {lines, checkedAt, url: page.url};
  return {name: page.name, url: page.url, status, checkedAt, previousCheckedAt: previous?.checkedAt || null, ...diff};
}

export function digest(results) {
  const lines = ['# Competitor page changes', ''];
  for (const result of results) {
    lines.push('## ' + result.name, result.url, 'Status: ' + result.status, 'Checked: ' + result.checkedAt);
    if (result.previousCheckedAt) lines.push('Previous snapshot: ' + result.previousCheckedAt);
    if (result.error) lines.push('Fetch or extraction error: ' + String(result.error).replace(/[\r\n]+/g, ' '));
    if (result.status === 'baseline') lines.push('First successful snapshot. Changes will appear after the next comparison.');
    for (const [label, values] of [['Added', result.added || []], ['Removed', result.removed || []]]) {
      if (values.length) { lines.push('', label + ':'); for (const value of values) lines.push('- ' + value.replace(/([\\`*_{}\[\]<>])/g, '\\$1')); }
    }
    lines.push('');
  }
  lines.push('Changes describe the fetched page text. They do not establish when a commercial policy took effect or why it changed.', '');
  return lines.join('\n');
}
