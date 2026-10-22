export type XmlValue = string | XmlValue[] | { [key: string]: XmlValue };

export class XmlSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlSyntaxError';
  }
}

interface XmlNode {
  attrs: Map<string, string>;
  children: Array<[string, XmlNode]>;
  own: string;
  full: string;
}

const XML_SPACE = /[ \t\n\r]/;
const NAME = /^[\p{Alphabetic}_][\p{Alphabetic}\p{Nd}\p{Nl}_.-]*$/u;
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function bad(message: string): XmlSyntaxError {
  return new XmlSyntaxError(`xml/parse: ${message}`);
}

function isBlank(text: string): boolean {
  for (const c of text) if (!XML_SPACE.test(c)) return false;
  return true;
}

function collapse(text: string): string {
  return text.split(/[ \t\n\r]+/).filter((part) => part !== '').join(' ');
}

function localName(qualified: string): string {
  const local = qualified.slice(qualified.lastIndexOf(':') + 1);
  if (!NAME.test(local)) throw bad(`invalid name \`${qualified}\``);
  return local;
}

function decodeEntities(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const amp = raw.indexOf('&', i);
    if (amp === -1) return out + raw.slice(i);
    out += raw.slice(i, amp);
    const semi = raw.indexOf(';', amp);
    if (semi === -1) throw bad('unterminated entity');
    const name = raw.slice(amp + 1, semi);
    if (Object.prototype.hasOwnProperty.call(PREDEFINED, name)) {
      out += PREDEFINED[name];
    } else if (/^#x[0-9A-Fa-f]+$/.test(name) || /^#[0-9]+$/.test(name)) {
      const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw bad(`invalid character reference \`&${name};\``);
      out += String.fromCodePoint(code);
    } else {
      throw bad(`unknown entity \`&${name};\``);
    }
    i = semi + 1;
  }
  return out;
}

function skipDoctype(text: string, from: number): number {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
    } else if (c === '>' && depth <= 0) {
      return i + 1;
    }
  }
  throw bad('unterminated doctype');
}

interface StartTag {
  qualified: string;
  node: XmlNode;
  empty: boolean;
  end: number;
}

function readStartTag(text: string, from: number): StartTag {
  let i = from + 1;
  const nameStart = i;
  while (i < text.length && !XML_SPACE.test(text[i]) && text[i] !== '/' && text[i] !== '>') i++;
  const qualified = text.slice(nameStart, i);
  localName(qualified);
  const node: XmlNode = { attrs: new Map(), children: [], own: '', full: '' };
  const seen = new Set<string>();
  for (;;) {
    while (i < text.length && XML_SPACE.test(text[i])) i++;
    if (i >= text.length) throw bad('unterminated tag');
    if (text[i] === '>') return { qualified, node, empty: false, end: i + 1 };
    if (text[i] === '/') {
      if (text[i + 1] !== '>') throw bad('malformed tag');
      return { qualified, node, empty: true, end: i + 2 };
    }
    const keyStart = i;
    while (i < text.length && !XML_SPACE.test(text[i]) && text[i] !== '=' && text[i] !== '>' && text[i] !== '/') i++;
    const key = text.slice(keyStart, i);
    while (i < text.length && XML_SPACE.test(text[i])) i++;
    if (text[i] !== '=') throw bad(`attribute \`${key}\` has no value`);
    i++;
    while (i < text.length && XML_SPACE.test(text[i])) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== "'") throw bad(`attribute \`${key}\` value is not quoted`);
    const close = text.indexOf(quote, i + 1);
    if (close === -1) throw bad('unterminated attribute value');
    const value = decodeEntities(text.slice(i + 1, close));
    i = close + 1;
    if (seen.has(key)) throw bad(`duplicate attribute \`${key}\``);
    seen.add(key);
    if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
    node.attrs.set(localName(key), value);
  }
}

function parseTree(text: string): XmlNode {
  const stack: Array<{ qualified: string; node: XmlNode }> = [];
  let root: XmlNode | null = null;

  const close = (node: XmlNode, name: string): void => {
    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      root = node;
    } else {
      parent.node.full += node.full;
      parent.node.children.push([name, node]);
    }
  };
  const addText = (piece: string): void => {
    const top = stack[stack.length - 1];
    if (top !== undefined) {
      top.node.own += piece;
      top.node.full += piece;
    } else if (!isBlank(piece)) {
      throw bad(root === null ? 'text before the root element' : 'text after the root element');
    }
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      const next = text.indexOf('<', i);
      const end = next === -1 ? text.length : next;
      addText(decodeEntities(text.slice(i, end)));
      i = end;
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) throw bad('unterminated comment');
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1) throw bad('unterminated CDATA');
      if (stack.length === 0) throw bad('CDATA outside the root element');
      addText(text.slice(i + 9, end));
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) throw bad('unterminated processing instruction');
      i = end + 2;
    } else if (text.startsWith('<!', i)) {
      i = skipDoctype(text, i + 2);
    } else if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      if (end === -1) throw bad('unterminated closing tag');
      const top = stack.pop();
      if (top === undefined) throw bad('unexpected closing tag');
      if (text.slice(i + 2, end).trim() !== top.qualified) throw bad(`mismatched closing tag for \`${top.qualified}\``);
      close(top.node, localName(top.qualified));
      i = end + 1;
    } else {
      if (root !== null && stack.length === 0) throw bad('more than one root element');
      const tag = readStartTag(text, i);
      if (tag.empty) close(tag.node, localName(tag.qualified));
      else stack.push({ qualified: tag.qualified, node: tag.node });
      i = tag.end;
    }
  }
  if (stack.length > 0) throw bad('unclosed element');
  if (root === null) throw bad('no root element');
  return root;
}

function toValue(node: XmlNode): XmlValue {
  const text = collapse(node.full);
  const ownHasText = !isBlank(node.own);
  if (node.attrs.size === 0 && (node.children.length === 0 || ownHasText)) return text;
  const entries: Array<[string, XmlValue]> = [];
  for (const [key, value] of node.attrs) entries.push([`@${key}`, value]);
  const groups = new Map<string, XmlValue[]>();
  for (const [name, child] of node.children) {
    const group = groups.get(name);
    if (group === undefined) groups.set(name, [toValue(child)]);
    else group.push(toValue(child));
  }
  for (const [name, group] of groups) entries.push([name, group.length === 1 ? group[0] : group]);
  if ((node.children.length === 0 || ownHasText) && text !== '') entries.push(['#text', text]);
  return Object.fromEntries(entries);
}

/** Every field path (through nested shapes and list elements) whose declared type is a list. */
export type XmlListPaths = ReadonlyArray<ReadonlyArray<string>>;

function applyListPaths(value: XmlValue, paths: XmlListPaths): XmlValue {
  if (Array.isArray(value)) return value.map((item) => applyListPaths(item, paths));
  if (typeof value === 'string') return value;
  const heads = new Set<string>();
  for (const path of paths) if (path.length > 0) heads.add(path[0]);
  const next: { [key: string]: XmlValue } = { ...value };
  for (const head of heads) {
    if (!Object.prototype.hasOwnProperty.call(next, head)) continue;
    let child = next[head];
    if (paths.some((path) => path.length === 1 && path[0] === head) && !Array.isArray(child)) child = [child];
    const rest = paths.filter((path) => path.length > 1 && path[0] === head).map((path) => path.slice(1));
    next[head] = rest.length > 0 ? applyListPaths(child, rest) : child;
  }
  return next;
}

/** With `listPaths`, each list-typed path always reads as a list: a lone child is wrapped, an absent one stays absent. */
export function parseXml(text: string, listPaths: XmlListPaths = []): XmlValue {
  const value = toValue(parseTree(text));
  return listPaths.length === 0 ? value : applyListPaths(value, listPaths);
}


export function xmlValid(text: string): boolean {
  try {
    parseTree(text);
    return true;
  } catch (error) {
    if (error instanceof XmlSyntaxError) return false;
    throw error;
  }
}

