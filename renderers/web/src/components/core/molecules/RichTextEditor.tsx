'use client';
/**
 * RichTextEditor Molecule Component
 *
 * A WYSIWYG rich text surface: one contentEditable document the author types
 * straight into, like writing an email. Formatting is inline — select text
 * and press the toolbar's bold / italic / heading / list buttons, or use the
 * browser's native shortcuts (Cmd/Ctrl+B, I, U). Enter and Backspace are the
 * browser's own editing; there is no block model.
 *
 * Markdown typing shortcuts convert as you write: "# " at a line start
 * becomes a heading, "- " a bullet list, "1. " a numbered list, "> " a
 * quote, "``` " a code block; inline **bold**, *italic* and `code` convert
 * the moment they close. The surface stays visual throughout.
 *
 * Content is HTML in and sanitized HTML out. The change stream is debounced
 * while typing and flushed on blur, so a click on a sibling Save/Done button
 * always sees the latest content.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline,
} from 'lucide-react';
import type { EventEmit, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface RichTextEditorProps extends A11yProps {
  /** The rich text content as HTML. Sanitized before rendering and on every change. */
  value?: string;
  onChange?: (value: string) => void;
  changeEvent?: EventEmit<{ value: string }>;
  readOnly?: boolean;
  placeholder?: string;
  showToolbar?: boolean;
  className?: string;
}

const CHANGE_DEBOUNCE_MS = 400;

/** Tag allowlist with the attributes each may keep. Everything else unwraps. */
const ALLOWED_ATTRS: Record<string, readonly string[]> = {
  p: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  ul: [],
  ol: [],
  li: [],
  blockquote: [],
  pre: [],
  code: [],
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  s: [],
  strike: [],
  br: [],
  hr: [],
  div: [],
  span: [],
  a: ['href'],
  img: ['src', 'alt'],
};

/** Tags whose entire subtree is dangerous and dropped outright. */
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button', 'textarea', 'select']);

function safeUrl(raw: string, kinds: readonly string[]): string | null {
  const url = raw.trim();
  if (url.startsWith('#') || url.startsWith('/')) return url;
  const lower = url.toLowerCase();
  for (const kind of kinds) {
    if (lower.startsWith(kind)) return url;
  }
  return null;
}

function sanitizeNode(el: Element): void {
  const children = Array.from(el.children);
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      child.remove();
      continue;
    }
    const allowed = ALLOWED_ATTRS[tag];
    if (!allowed) {
      // Unknown tag: keep its text/children, lose the wrapper.
      sanitizeNode(child);
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowed.includes(name)) {
        child.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href') {
        const url = safeUrl(attr.value, ['http://', 'https://', 'mailto:']);
        if (url === null) child.removeAttribute(attr.name);
        else child.setAttribute('href', url);
      }
      if (name === 'src') {
        const url = safeUrl(attr.value, ['http://', 'https://', 'data:image/']);
        if (url === null) child.remove();
        else child.setAttribute('src', url);
      }
    }
    sanitizeNode(child);
  }
}

export function sanitizeRichHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  // A document that is only empty paragraphs (the editor's structural seed)
  // is empty content.
  if (!doc.body.querySelector('img, hr') && (doc.body.textContent ?? '').trim().length === 0) {
    return '';
  }
  // Zero-width spaces are caret landing pads left by inline markdown
  // conversion — presentation-only, never content.
  return doc.body.innerHTML.replace(/​/g, '');
}

function htmlIsEmpty(el: HTMLElement): boolean {
  if (el.querySelector('img, hr')) return false;
  return (el.textContent ?? '').trim().length === 0;
}

/** Markdown line prefixes: prefix + space at a line start converts the line. */
const MD_BLOCK_PREFIXES: Record<string, { kind: 'block'; tag: string } | { kind: 'list'; command: 'insertUnorderedList' | 'insertOrderedList' }> = {
  '#': { kind: 'block', tag: 'h1' },
  '##': { kind: 'block', tag: 'h2' },
  '###': { kind: 'block', tag: 'h3' },
  '>': { kind: 'block', tag: 'blockquote' },
  '```': { kind: 'block', tag: 'pre' },
  '-': { kind: 'list', command: 'insertUnorderedList' },
  '*': { kind: 'list', command: 'insertUnorderedList' },
  '1.': { kind: 'list', command: 'insertOrderedList' },
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE']);

function closestBlock(node: Node, root: HTMLElement): Element | null {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (cur instanceof Element && BLOCK_TAGS.has(cur.tagName)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/** Inline markdown that converts when its closing marker was just typed. */
const MD_INLINE_RULES: readonly { pattern: RegExp; wrap: 'strong' | 'em' | 'code' }[] = [
  { pattern: /\*\*([^*\n]+)\*\*$/, wrap: 'strong' },
  { pattern: /(^|[^*])\*([^*\n]+)\*$/, wrap: 'em' },
  { pattern: /`([^`\n]+)`$/, wrap: 'code' },
];

/**
 * Self-contained document typography. Tailwind's `prose` plugin is not part
 * of any build in this repo (MarkdownContent's prose classes render flat),
 * so the rich text surface ships its own scoped styles — they work in the
 * playground and in every emitted app with zero build configuration.
 */
const RICH_TEXT_CSS = `
.almadar-rich-text { line-height: 1.7; color: var(--color-foreground); }
.almadar-rich-text h1 { font-size: 1.875rem; font-weight: 700; line-height: 1.25; margin: 1.25em 0 0.4em; }
.almadar-rich-text h2 { font-size: 1.5rem; font-weight: 650; line-height: 1.3; margin: 1.1em 0 0.4em; }
.almadar-rich-text h3 { font-size: 1.25rem; font-weight: 600; line-height: 1.35; margin: 1em 0 0.35em; }
.almadar-rich-text h1:first-child, .almadar-rich-text h2:first-child, .almadar-rich-text h3:first-child { margin-top: 0; }
.almadar-rich-text p { margin: 0.5em 0; }
.almadar-rich-text ul { list-style: disc; padding-inline-start: 1.5rem; margin: 0.5em 0; }
.almadar-rich-text ol { list-style: decimal; padding-inline-start: 1.5rem; margin: 0.5em 0; }
.almadar-rich-text li { margin: 0.25em 0; }
.almadar-rich-text blockquote { border-inline-start: 3px solid var(--color-primary); padding-inline-start: 1rem; font-style: italic; color: var(--color-muted-foreground); margin: 0.75em 0; }
.almadar-rich-text pre { background: var(--color-muted); border: 1px solid var(--color-border); border-radius: 0.375rem; padding: 0.75rem 1rem; font-family: ui-monospace, monospace; font-size: 0.875em; white-space: pre-wrap; margin: 0.75em 0; }
.almadar-rich-text code { font-family: ui-monospace, monospace; font-size: 0.875em; background: var(--color-muted); border-radius: 0.25rem; padding: 0.1em 0.35em; }
.almadar-rich-text pre code { background: transparent; padding: 0; }
.almadar-rich-text a { color: var(--color-primary); text-decoration: underline; }
.almadar-rich-text hr { border: none; border-top: 1px solid var(--color-border); margin: 1.25em 0; }
.almadar-rich-text img { max-width: 100%; border-radius: 0.375rem; }
`;

function RichTextStyles() {
  return <style>{RICH_TEXT_CSS}</style>;
}

type InlineCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough';
type BlockTag = 'h1' | 'h2' | 'h3' | 'blockquote' | 'pre' | 'p';

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  block: BlockTag | null;
  bullets: boolean;
  numbers: boolean;
  link: boolean;
}

const IDLE_TOOLBAR: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  block: null,
  bullets: false,
  numbers: false,
  link: false,
};

function readToolbarState(root: HTMLElement): ToolbarState {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return IDLE_TOOLBAR;
  const anchor = sel.anchorNode;
  if (!anchor || !root.contains(anchor)) return IDLE_TOOLBAR;
  let block: BlockTag | null = null;
  let link = false;
  let node: Node | null = anchor;
  while (node && node !== root) {
    if (node instanceof Element) {
      const tag = node.tagName.toLowerCase();
      if (!block && (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'blockquote' || tag === 'pre')) {
        block = tag;
      }
      if (tag === 'a') link = true;
    }
    node = node.parentNode;
  }
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    strikeThrough: document.queryCommandState('strikeThrough'),
    block,
    bullets: document.queryCommandState('insertUnorderedList'),
    numbers: document.queryCommandState('insertOrderedList'),
    link,
  };
}

interface ToolbarButtonProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  active?: boolean;
  onExec: () => void;
}

function ToolbarButton({ icon: IconCmp, label, active, onExec }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'h-8 w-8 p-0 gap-0 justify-center',
        active && 'bg-muted text-foreground',
      )}
      onMouseDown={(e) => {
        // Keep the selection: a mousedown on the toolbar must not blur the text.
        e.preventDefault();
        onExec();
      }}
    >
      <IconCmp size={15} />
    </Button>
  );
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  changeEvent,
  readOnly = false,
  placeholder,
  showToolbar = true,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const ref = useRef<HTMLDivElement | null>(null);
  const [toolbar, setToolbar] = useState<ToolbarState>(IDLE_TOOLBAR);
  const [empty, setEmpty] = useState(() => !value || !sanitizeRichHtml(value).trim());
  const eventBus = useEventBus();
  const onChangeRef = useRef(onChange);
  const changeEventRef = useRef(changeEvent);
  useEffect(() => {
    onChangeRef.current = onChange;
    changeEventRef.current = changeEvent;
  }, [onChange, changeEvent]);

  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitNow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const html = sanitizeRichHtml(el.innerHTML);
    onChangeRef.current?.(html);
    const evt = changeEventRef.current;
    if (evt) eventBus.emit(`UI:${evt}`, { value: html });
  }, [eventBus]);
  const scheduleEmit = useCallback(() => {
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      emitTimerRef.current = null;
      emitNow();
    }, CHANGE_DEBOUNCE_MS);
  }, [emitNow]);
  const flushEmit = useCallback(() => {
    if (!emitTimerRef.current) return;
    clearTimeout(emitTimerRef.current);
    emitTimerRef.current = null;
    emitNow();
  }, [emitNow]);
  useEffect(() => () => {
    if (emitTimerRef.current) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
      emitNow();
    }
  }, [emitNow]);

  // Load / external-value sync: only while the surface isn't being typed in.
  // An empty surface is seeded with one paragraph — without it the first
  // line is a bare text node under the root and block commands (headings,
  // lists, the "# " markdown shortcut) have no block to act on.
  useEffect(() => {
    if (readOnly) return;
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = sanitizeRichHtml(value ?? '') || '<p><br></p>';
    if (el.innerHTML !== next) {
      el.innerHTML = next;
      setEmpty(htmlIsEmpty(el));
    }
  }, [readOnly, value]);

  // New paragraphs are <p>, not <div>, so the document reads as a document.
  useEffect(() => {
    if (readOnly) return;
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, [readOnly]);

  // Toolbar active states track the caret.
  useEffect(() => {
    if (readOnly || !showToolbar) return;
    const onSelectionChange = () => {
      const el = ref.current;
      if (!el) return;
      setToolbar(readToolbarState(el));
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [readOnly, showToolbar]);

  /** Inline markdown (**bold**, *italic*, `code`) converts as its closing marker lands. */
  const tryInlineMarkdown = useCallback((): boolean => {
    const root = ref.current;
    if (!root) return false;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return false;
    if (node.parentElement?.closest('code, pre')) return false;
    const text = (node.textContent ?? '').slice(0, sel.anchorOffset);
    for (const rule of MD_INLINE_RULES) {
      const m = rule.pattern.exec(text);
      if (!m) continue;
      const inner = rule.wrap === 'em' ? m[2] : m[1];
      if (!inner || !inner.trim()) continue;
      const lead = rule.wrap === 'em' ? (m[1]?.length ?? 0) : 0;
      const range = document.createRange();
      range.setStart(node, m.index + lead);
      range.setEnd(node, sel.anchorOffset);
      const el = document.createElement(rule.wrap);
      el.textContent = inner;
      range.deleteContents();
      range.insertNode(el);
      // Caret lands in a fresh text node after the element, so typing
      // continues unformatted; the pad character never reaches storage.
      const after = document.createTextNode('​');
      el.parentNode?.insertBefore(after, el.nextSibling);
      const caret = document.createRange();
      caret.setStart(after, 1);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      return true;
    }
    return false;
  }, []);

  /** Markdown line prefixes ("# ", "- ", "> ", "1. ", "``` ") convert on space. */
  const tryBlockMarkdown = useCallback((): boolean => {
    const root = ref.current;
    if (!root) return false;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return false;
    const block = closestBlock(node, root);
    if (block ? block.firstChild !== node : root.firstChild !== node) return false;
    const prefix = (node.textContent ?? '').slice(0, sel.anchorOffset);
    const rule = MD_BLOCK_PREFIXES[prefix];
    if (!rule) return false;
    if (node.parentElement?.closest('pre, code')) return false;
    if (rule.kind === 'list' && node.parentElement?.closest('li')) return false;
    (node as Text).deleteData(0, prefix.length);
    const caret = document.createRange();
    caret.setStart(node, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    if (rule.kind === 'list') {
      // Manual conversion: Chrome's insertUnorderedList merges neighbouring
      // paragraphs when invoked mid-document, so the current block is
      // replaced with a fresh single-item list instead.
      const container = block ?? node.parentElement;
      const list = document.createElement(rule.command === 'insertOrderedList' ? 'ol' : 'ul');
      const li = document.createElement('li');
      if (block) {
        while (block.firstChild) li.appendChild(block.firstChild);
        list.appendChild(li);
        block.replaceWith(list);
      } else if (container) {
        li.appendChild(node);
        list.appendChild(li);
        container.appendChild(list);
      }
      if (!li.firstChild) li.appendChild(document.createElement('br'));
      const liCaret = document.createRange();
      liCaret.selectNodeContents(li);
      liCaret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(liCaret);
    } else {
      document.execCommand('formatBlock', false, rule.tag);
    }
    return true;
  }, []);

  const afterEdit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Script-driven DOM mutation fires no input event, so this cannot recurse.
    tryInlineMarkdown();
    setEmpty(htmlIsEmpty(el));
    setToolbar(readToolbarState(el));
    scheduleEmit();
  }, [scheduleEmit, tryInlineMarkdown]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' && tryBlockMarkdown()) {
      e.preventDefault();
      afterEdit();
    }
  }, [afterEdit, tryBlockMarkdown]);

  const execInline = useCallback((command: InlineCommand) => {
    document.execCommand(command, false);
    afterEdit();
  }, [afterEdit]);

  const execBlock = useCallback((tag: BlockTag) => {
    // Pressing the active heading again returns the line to a paragraph.
    const next = toolbar.block === tag ? 'p' : tag;
    document.execCommand('formatBlock', false, next);
    afterEdit();
  }, [afterEdit, toolbar.block]);

  const execList = useCallback((command: 'insertUnorderedList' | 'insertOrderedList') => {
    document.execCommand(command, false);
    afterEdit();
  }, [afterEdit]);

  const execLink = useCallback(() => {
    if (toolbar.link) {
      document.execCommand('unlink', false);
      afterEdit();
      return;
    }
    const url = window.prompt(t('richTextEditor.linkPrompt'));
    if (!url) return;
    const safe = safeUrl(url, ['http://', 'https://', 'mailto:']) ?? `https://${url}`;
    document.execCommand('createLink', false, safe);
    afterEdit();
  }, [afterEdit, t, toolbar.link]);

  // Insert-image is a real file picker: the OS dialog blurs the editor, so
  // the caret's range is saved before opening and restored before inserting.
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const execImage = useCallback(() => {
    const root = ref.current;
    const sel = window.getSelection();
    savedRangeRef.current =
      root && sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)
        ? sel.getRangeAt(0).cloneRange()
        : null;
    imageInputRef.current?.click();
  }, []);

  const handleImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (!url.startsWith('data:image/')) return;
      const root = ref.current;
      if (!root) return;
      root.focus();
      const sel = window.getSelection();
      if (sel && savedRangeRef.current && root.contains(savedRangeRef.current.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      }
      document.execCommand('insertImage', false, url);
      afterEdit();
    };
    reader.readAsDataURL(file);
  }, [afterEdit]);

  const execRule = useCallback(() => {
    document.execCommand('insertHorizontalRule', false);
    afterEdit();
  }, [afterEdit]);

  if (readOnly) {
    return (
      <Box {...domPassthrough(rest)} className={cn('almadar-rich-text max-w-none', className)}>
        <RichTextStyles />
        <Box dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value ?? '') }} />
      </Box>
    );
  }

  return (
    <Box {...domPassthrough(rest)} className={cn('flex flex-col gap-2', className)}>
      <RichTextStyles />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleImageFile}
      />
      {showToolbar && (
        <Box
          role="toolbar"
          aria-label={t('richTextEditor.editorToolbar')}
          className={cn(
            'sticky top-0 z-10 flex flex-wrap items-center gap-0.5 self-start',
            'rounded-container border border-border bg-background/95 px-1 py-0.5 shadow-elevation-popover',
          )}
        >
          <ToolbarButton icon={Bold} label={t('richTextEditor.bold')} active={toolbar.bold} onExec={() => execInline('bold')} />
          <ToolbarButton icon={Italic} label={t('richTextEditor.italic')} active={toolbar.italic} onExec={() => execInline('italic')} />
          <ToolbarButton icon={Underline} label={t('richTextEditor.underline')} active={toolbar.underline} onExec={() => execInline('underline')} />
          <ToolbarButton icon={Strikethrough} label={t('richTextEditor.strikethrough')} active={toolbar.strikeThrough} onExec={() => execInline('strikeThrough')} />
          <Box className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton icon={Heading1} label={t('richTextEditor.heading1')} active={toolbar.block === 'h1'} onExec={() => execBlock('h1')} />
          <ToolbarButton icon={Heading2} label={t('richTextEditor.heading2')} active={toolbar.block === 'h2'} onExec={() => execBlock('h2')} />
          <ToolbarButton icon={Heading3} label={t('richTextEditor.heading3')} active={toolbar.block === 'h3'} onExec={() => execBlock('h3')} />
          <Box className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton icon={List} label={t('richTextEditor.bulletList')} active={toolbar.bullets} onExec={() => execList('insertUnorderedList')} />
          <ToolbarButton icon={ListOrdered} label={t('richTextEditor.numberedList')} active={toolbar.numbers} onExec={() => execList('insertOrderedList')} />
          <Box className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton icon={Quote} label={t('richTextEditor.quote')} active={toolbar.block === 'blockquote'} onExec={() => execBlock('blockquote')} />
          <ToolbarButton icon={Code} label={t('richTextEditor.code')} active={toolbar.block === 'pre'} onExec={() => execBlock('pre')} />
          <ToolbarButton icon={LinkIcon} label={toolbar.link ? t('richTextEditor.removeLink') : t('richTextEditor.link')} active={toolbar.link} onExec={execLink} />
          <ToolbarButton icon={ImageIcon} label={t('richTextEditor.image')} onExec={execImage} />
          <ToolbarButton icon={Minus} label={t('richTextEditor.divider')} onExec={execRule} />
        </Box>
      )}
      <Box
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t('richTextEditor.editorSurface')}
        data-placeholder={placeholder ?? t('richTextEditor.placeholder')}
        data-empty={empty ? 'true' : 'false'}
        className={cn(
          'almadar-rich-text max-w-none min-h-[8rem] outline-none',
          'focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring focus-visible:ring-inset',
          'data-[empty=true]:before:content-[attr(data-placeholder)]',
          'data-[empty=true]:before:text-muted-foreground/60',
          'data-[empty=true]:before:pointer-events-none',
          'data-[empty=true]:before:absolute',
          'relative cursor-text',
        )}
        onInput={afterEdit}
        onKeyDown={handleKeyDown}
        onBlur={flushEmit}
      />
    </Box>
  );
};

RichTextEditor.displayName = 'RichTextEditor';
