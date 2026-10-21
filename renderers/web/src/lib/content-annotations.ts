export type AnnotationKind = 'question' | 'note';

export interface ContentAnnotation {
  /** Unique id, echoed in the click event payload */
  id: string;
  /** Exact passage to highlight (first occurrence in the rendered text) */
  text: string;
  /** Highlight colour: `question` or `note` */
  kind: AnnotationKind;
}

type HastProperties = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: HastProperties;
  children?: HastNode[];
}

const OPAQUE_TAGS = new Set(['code', 'pre', 'mark']);

function splitFirstMatch(node: HastNode, annotation: ContentAnnotation): boolean {
  const children = node.children;
  if (!children) return false;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'text' && typeof child.value === 'string') {
      const at = child.value.indexOf(annotation.text);
      if (at < 0) continue;
      const before = child.value.slice(0, at);
      const after = child.value.slice(at + annotation.text.length);
      const replacement: HastNode[] = [];
      if (before) replacement.push({ type: 'text', value: before });
      replacement.push({
        type: 'element',
        tagName: 'mark',
        properties: { dataAnnotationId: annotation.id, dataAnnotationKind: annotation.kind },
        children: [{ type: 'text', value: annotation.text }],
      });
      if (after) replacement.push({ type: 'text', value: after });
      children.splice(i, 1, ...replacement);
      return true;
    }
    if (child.type === 'element' && child.tagName && OPAQUE_TAGS.has(child.tagName)) continue;
    if (splitFirstMatch(child, annotation)) return true;
  }
  return false;
}

/**
 * Rehype plugin: wraps the first occurrence of each annotation's exact text
 * (document order, within one text node, outside code) in a `mark` element
 * carrying its id and kind. Annotations are applied in array order.
 */
export function rehypeAnnotate(annotations: readonly ContentAnnotation[]) {
  return () => (tree: HastNode) => {
    for (const annotation of annotations) {
      if (annotation.text.length === 0) continue;
      splitFirstMatch(tree, annotation);
    }
  };
}
