'use client';

/**
 * FileTree Molecule
 *
 * A filesystem tree navigator with folder expand/collapse, file-type icons,
 * and click-to-select. Used by the Workspace tab to browse the agent's
 * workspace directory.
 *
 * Follows atomic design: composes Box, Icon, Typography atoms.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { pressableProps } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { Icon } from '../../../core';
import { useDraggable, type DraggablePayload } from '../../../hooks/useDraggable';
import { useDropZone } from '../../../hooks/useDropZone';
import { useTranslate } from '../../../core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileTreeNode {
  /** File or directory name */
  name: string;
  /** Relative path from workspace root */
  path: string;
  /** 'file' or 'dir' */
  type: 'file' | 'dir';
  /** A directory's entries — or, on a file, the files derived from it (a `.lolo` source's `.orb`), nested under it. */
  children?: FileTreeNode[];
  /** A short muted note after the name (e.g. "generated"). */
  note?: string;
  /** Has children not loaded yet: shows the toggle, and expanding it calls `onNodeExpand`. */
  expandable?: boolean;
  /** File size in bytes (optional, for display) */
  size?: number;
  /** Detected language for syntax highlighting */
  language?: string;
}

/** Flat tree row for `items` mode — nested at render time by `parentId`. */
export interface FileTreeItem {
  /** Unique node id */
  id: string;
  /** Display label */
  label: string;
  /** Id of this node's parent; empty/absent marks a root */
  parentId?: string;
  /** Icon name override (falls back to folder/file by presence of children) */
  icon?: string;
}

export interface FileTreeProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** The tree data (pre-nested). Ignored when `items` is provided. */
  tree?: FileTreeNode[];
  /** Flat node list, nested by `parentId` at render time — takes precedence
   *  over `tree` when provided. A `parentId` with no matching row renders
   *  that node as a root rather than dropping it. */
  items?: FileTreeItem[];
  /** Currently selected file path */
  selectedPath?: string;
  /** Currently selected node id, in flat `items` mode: the row highlights
   *  and every ancestor auto-expands so the selection is always visible —
   *  the "you are here" a navigation tree needs. */
  selectedId?: string;
  /** Visual treatment for flat `items` mode: `files` (default) keeps the
   *  monospace file-browser look; `nav` renders a sidebar navigation tree —
   *  regular font, document icons, roomier hit areas. */
  look?: 'files' | 'nav';
  /** Called when a file is clicked */
  onFileSelect?: (path: string) => void;
  /** Called the first time a node marked `expandable` is expanded, with its path, so its children can be loaded. */
  onNodeExpand?: (path: string) => void;
  /** Paths to show expanded (e.g. to reveal a node): each is expanded when it appears here, loading its children if needed. */
  expandedPaths?: readonly string[];
  /** Called when a node is clicked, in flat `items` mode; carries the
   *  selected node's id. Presence-gated: binding this prop is what turns on
   *  the click-to-select affordance, mirroring Badge's `onRemove`.
   *  @offByDefault */
  onNodeSelect?: (id: string) => void;
  /** Called from the row's hover action button, in flat `items` mode;
   *  carries that node's id. Presence-gated: binding it renders the action.
   *  @offByDefault */
  onNodeAction?: (id: string) => void;
  /** Icon for the row hover action (default: plus). */
  nodeActionIcon?: string;
  /** Accessible label/tooltip for the row hover action. */
  nodeActionLabel?: string;
  /** Called when a row is dropped onto another, in flat `items` mode; carries
   *  the moved node's id, its new parent id (`null` for a root drop), and its
   *  index within the new parent's children. Presence-gated: binding this
   *  prop is what turns on row dragging.
   *  @offByDefault */
  onNodeReorder?: (id: string, newParentId: string | null, index: number) => void;
  /** CSS class */
  className?: string;
  /** Indent size per level in px (default: 16) */
  indent?: number;
}

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts': case 'tsx': return 'file-code';
    case 'js': case 'jsx': return 'file-code';
    case 'json': case 'orb': return 'file-json';
    case 'css': case 'scss': return 'file-text';
    case 'md': return 'file-text';
    case 'py': return 'file-code';
    case 'html': return 'file-code';
    default: return 'file';
  }
}

// ---------------------------------------------------------------------------
// Keyboard model (WAI-ARIA APG tree: roving tabindex + arrow keys)
// ---------------------------------------------------------------------------

interface TreeNavValue {
  activeKey: string | undefined;
  setActive: (key: string) => void;
}

const TreeNavContext = createContext<TreeNavValue>({ activeKey: undefined, setActive: () => {} });

function levelOf(el: HTMLElement): number {
  return Number(el.getAttribute('aria-level') ?? '1');
}

interface RowKeyState {
  expanded: boolean | undefined;
  toggle: () => void;
}

function treeRowKeyDown(e: React.KeyboardEvent<HTMLElement>, state: RowKeyState): void {
  if (e.target !== e.currentTarget) return;
  const row = e.currentTarget;
  const tree = row.closest<HTMLElement>('[role="tree"]');
  if (!tree) return;
  const rows = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const idx = rows.indexOf(row);
  const focusRow = (target: HTMLElement | undefined) => {
    if (!target) return;
    e.preventDefault();
    target.focus();
  };
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault();
      row.click();
      return;
    case 'ArrowDown':
      focusRow(rows[idx + 1]);
      return;
    case 'ArrowUp':
      focusRow(rows[idx - 1]);
      return;
    case 'Home':
      focusRow(rows[0]);
      return;
    case 'End':
      focusRow(rows[rows.length - 1]);
      return;
    case 'ArrowRight':
      if (state.expanded === false) {
        e.preventDefault();
        state.toggle();
      } else if (state.expanded === true) {
        const next = rows[idx + 1];
        if (next && levelOf(next) > levelOf(row)) focusRow(next);
      }
      return;
    case 'ArrowLeft':
      if (state.expanded === true) {
        e.preventDefault();
        state.toggle();
      } else {
        const level = levelOf(row);
        focusRow(rows.slice(0, idx).reverse().find((r) => levelOf(r) < level));
      }
      return;
    default:
  }
}

function TreeRoot({
  defaultKey,
  className,
  rest,
  children,
}: {
  defaultKey: string | undefined;
  className?: string;
  rest: object;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active === undefined) return;
    if (!rootRef.current?.querySelector('[role="treeitem"][tabindex="0"]')) setActive(undefined);
  });
  const value = React.useMemo(() => ({ activeKey: active ?? defaultKey, setActive }), [active, defaultKey]);
  return (
    <TreeNavContext.Provider value={value}>
      <Box ref={rootRef} className={`py-1 overflow-y-auto ${className ?? ''}`} {...domPassthrough(rest)} role="tree">
        {children}
      </Box>
    </TreeNavContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// TreeNode (recursive)
// ---------------------------------------------------------------------------

interface TreeNodeItemProps {
  node: FileTreeNode;
  depth: number;
  indent: number;
  selectedPath?: string;
  onFileSelect?: (path: string) => void;
  onNodeExpand?: (path: string) => void;
  expandedPaths?: readonly string[];
  defaultExpanded?: boolean;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  depth,
  indent,
  selectedPath,
  onFileSelect,
  onNodeExpand,
  expandedPaths,
  defaultExpanded = false,
}) => {
  const isDir = node.type === 'dir';
  const hasDerived = !isDir && ((node.children?.length ?? 0) > 0 || node.expandable === true);
  const askedRef = useRef(false);
  const revealed = expandedPaths?.includes(node.path) === true;
  useEffect(() => {
    if (!revealed) return;
    setExpanded(true);
    if (node.expandable === true && !askedRef.current) {
      askedRef.current = true;
      onNodeExpand?.(node.path);
    }
  }, [revealed, node.expandable, node.path, onNodeExpand]);
  const [expanded, setExpanded] = useState(isDir && (defaultExpanded || depth < 1));
  const isSelected = node.path === selectedPath;
  const { t } = useTranslate();
  const nav = useContext(TreeNavContext);

  const toggleDerived = useCallback(() => {
    if (!expanded && node.expandable === true && !askedRef.current) {
      askedRef.current = true;
      onNodeExpand?.(node.path);
    }
    setExpanded((prev) => !prev);
  }, [expanded, node.expandable, node.path, onNodeExpand]);

  const handleClick = useCallback(() => {
    if (isDir) {
      setExpanded(prev => !prev);
    } else {
      onFileSelect?.(node.path);
    }
  }, [isDir, node.path, onFileSelect]);

  return (
    <>
      <Box
        className={`flex items-center gap-1.5 py-0.5 px-2 cursor-pointer rounded-interactive transition-colors ${
          isSelected
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-muted'
        }`}
        style={{ paddingLeft: depth * indent + 8 }}
        onClick={handleClick}
        role="treeitem"
        tabIndex={nav.activeKey === node.path ? 0 : -1}
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={isDir || hasDerived ? expanded : undefined}
        onFocus={() => nav.setActive(node.path)}
        onKeyDown={(e: React.KeyboardEvent<HTMLElement>) =>
          treeRowKeyDown(e, {
            expanded: isDir || hasDerived ? expanded : undefined,
            toggle: isDir ? () => setExpanded((prev) => !prev) : toggleDerived,
          })}
      >
        {isDir ? (
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size="xs"
            className="text-[var(--color-muted-foreground)] flex-shrink-0"
          />
        ) : hasDerived ? (
          <Box
            {...pressableProps((e: React.MouseEvent) => {
              e.stopPropagation();
              toggleDerived();
            })}
            tabIndex={-1}
            aria-expanded={expanded}
            aria-label={expanded ? t('fileTree.collapse') : t('fileTree.expand')}
            data-testid={`file-tree-toggle-${node.path}`}
            className="flex-shrink-0 flex items-center"
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="xs" className="text-[var(--color-muted-foreground)]" />
          </Box>
        ) : (
          <Box style={{ width: 12, flexShrink: 0 }} />
        )}
        <Icon
          name={isDir ? (expanded ? 'folder-open' : 'folder') : fileIcon(node.name)}
          size="xs"
          className={isSelected
            ? 'text-inherit'
            : isDir ? 'text-[var(--color-warning)]' : 'text-[var(--color-muted-foreground)]'}
        />
        <Typography
          variant="caption"
          className={`truncate font-mono text-xs !text-inherit ${isSelected ? 'font-semibold' : ''}`}
        >
          {node.name}
        </Typography>
        {node.note !== undefined && (
          <Typography variant="caption" className={`text-[9px] flex-shrink-0 ${isSelected ? '!text-inherit opacity-80' : 'text-[var(--color-muted-foreground)]'}`}>
            {node.note}
          </Typography>
        )}
        {!isDir && node.size !== undefined && (
          <Typography
            variant="caption"
            className={`text-[9px] ml-auto flex-shrink-0 ${isSelected ? '!text-inherit opacity-80' : 'text-[var(--color-muted-foreground)]'}`}
          >
            {node.size < 1024 ? `${node.size}B` : `${Math.round(node.size / 1024)}KB`}
          </Typography>
        )}
      </Box>
      {(isDir || hasDerived) && expanded && node.children && (
        <Box role="group">
          {node.children.map(child => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              indent={indent}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
              onNodeExpand={onNodeExpand}
              expandedPaths={expandedPaths}
              defaultExpanded={depth < 0}
            />
          ))}
        </Box>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// FlatTreeNodeItem (recursive) — `items` mode
// ---------------------------------------------------------------------------

interface FlatTreeNodeItemProps {
  item: FileTreeItem;
  depth: number;
  indent: number;
  childrenByParent: Map<string, FileTreeItem[]>;
  /** Root-level items, in render order — a target row's own sibling list
   *  when it has no valid parent. Used to resolve drop index/parent. */
  roots: FileTreeItem[];
  onNodeSelect?: (id: string) => void;
  onNodeAction?: (id: string) => void;
  nodeActionIcon?: string;
  nodeActionLabel?: string;
  onNodeReorder?: (id: string, newParentId: string | null, index: number) => void;
  selectedId?: string;
  look: 'files' | 'nav';
  isExpanded: (id: string, depth: number) => boolean;
  onToggle: (id: string, effective: boolean) => void;
}

/** The list `target` renders alongside — `roots` when it has no valid parent row. */
function siblingsOf(
  target: FileTreeItem,
  roots: FileTreeItem[],
  childrenByParent: Map<string, FileTreeItem[]>,
): FileTreeItem[] {
  if (target.parentId) {
    const parentSiblings = childrenByParent.get(target.parentId);
    if (parentSiblings?.some(sibling => sibling.id === target.id)) return parentSiblings;
  }
  return roots;
}

const FlatTreeNodeItem: React.FC<FlatTreeNodeItemProps> = ({
  item,
  depth,
  indent,
  childrenByParent,
  roots,
  onNodeSelect,
  onNodeAction,
  nodeActionIcon,
  nodeActionLabel,
  onNodeReorder,
  selectedId,
  look,
  isExpanded,
  onToggle,
}) => {
  const { t } = useTranslate();
  const children = childrenByParent.get(item.id);
  const hasChildren = !!children && children.length > 0;
  const expanded = hasChildren && isExpanded(item.id, depth);
  const isSelected = selectedId !== undefined && selectedId !== '' && item.id === selectedId;
  const nav = look === 'nav';
  const rowRef = useRef<HTMLDivElement>(null);
  const treeNav = useContext(TreeNavContext);

  const handleClick = useCallback(() => {
    if (hasChildren && !onNodeSelect) onToggle(item.id, expanded);
    onNodeSelect?.(item.id);
  }, [hasChildren, expanded, item.id, onNodeSelect, onToggle]);

  const handleChevron = useCallback((e: React.MouseEvent) => {
    // The chevron only folds; navigation stays on the row itself.
    e.stopPropagation();
    onToggle(item.id, expanded);
  }, [item.id, expanded, onToggle]);

  const handleAction = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onNodeAction?.(item.id);
  }, [item.id, onNodeAction]);

  const { dragProps } = useDraggable({
    payload: { kind: 'tree-node', data: { id: item.id } },
    disabled: !onNodeReorder,
  });

  const handleRowDrop = useCallback(
    (payload: DraggablePayload, position: { x: number; y: number }) => {
      if (!onNodeReorder) return;
      const draggedId = typeof payload.data.id === 'string' ? payload.data.id : undefined;
      if (!draggedId || draggedId === item.id) return;

      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;

      // Top third: drop before. Bottom third: drop after. Middle third: drop into.
      const relY = position.y - rect.top;
      const third = rect.height / 3;

      if (relY >= third && relY <= third * 2) {
        const existingChildren = childrenByParent.get(item.id);
        onNodeReorder(draggedId, item.id, existingChildren ? existingChildren.length : 0);
        return;
      }

      const siblings = siblingsOf(item, roots, childrenByParent);
      const newParentId = siblings === roots ? null : (item.parentId ?? null);
      const targetIndex = siblings.findIndex(sibling => sibling.id === item.id);
      const index = relY < third
        ? (targetIndex < 0 ? 0 : targetIndex)
        : (targetIndex < 0 ? siblings.length : targetIndex + 1);
      onNodeReorder(draggedId, newParentId, index);
    },
    [onNodeReorder, item, roots, childrenByParent],
  );

  const { dropProps } = useDropZone({
    accepts: ['tree-node'],
    onDrop: handleRowDrop,
    disabled: !onNodeReorder,
  });

  return (
    <>
      <Box
        ref={rowRef}
        className={`group/treerow flex items-center gap-1.5 px-2 cursor-pointer rounded-interactive transition-colors ${
          nav ? 'py-1' : 'py-0.5'
        } ${isSelected ? 'bg-primary text-primary-foreground' : nav ? 'text-foreground hover:bg-muted' : 'hover:bg-muted'}`}
        style={{ paddingLeft: depth * indent + 8 }}
        onClick={handleClick}
        role="treeitem"
        tabIndex={treeNav.activeKey === item.id ? 0 : -1}
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
        onFocus={() => treeNav.setActive(item.id)}
        onKeyDown={(e: React.KeyboardEvent<HTMLElement>) =>
          treeRowKeyDown(e, {
            expanded: hasChildren ? expanded : undefined,
            toggle: () => onToggle(item.id, expanded),
          })}
        {...dragProps}
        {...dropProps}
      >
        {hasChildren ? (
          <Box {...pressableProps(handleChevron)} tabIndex={-1} className="flex items-center flex-shrink-0" aria-label={expanded ? t('fileTree.collapse') : t('fileTree.expand')}>
            <Icon
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size="xs"
              className={isSelected ? 'text-inherit' : 'text-[var(--color-muted-foreground)]'}
            />
          </Box>
        ) : (
          <Box style={{ width: 12, flexShrink: 0 }} />
        )}
        <Icon
          name={item.icon || (nav ? 'file-text' : hasChildren ? (expanded ? 'folder-open' : 'folder') : 'file')}
          size="xs"
          className={isSelected
            ? 'text-inherit'
            : nav || !hasChildren ? 'text-[var(--color-muted-foreground)]' : 'text-[var(--color-warning)]'}
        />
        <Typography
          variant="caption"
          className={`truncate ${nav ? 'text-sm' : 'font-mono text-xs'} !text-inherit ${isSelected ? 'font-semibold' : ''}`}
        >
          {item.label}
        </Typography>
        {onNodeAction && (
          <Box
            {...pressableProps(handleAction)}
            tabIndex={treeNav.activeKey === item.id ? 0 : -1}
            aria-label={nodeActionLabel ?? t('fileTree.nodeAction')}
            title={nodeActionLabel}
            className={`ml-auto flex-shrink-0 rounded-interactive p-0.5 opacity-0 group-hover/treerow:opacity-100 group-focus-within/treerow:opacity-100 transition-opacity ${
              isSelected ? 'hover:bg-primary-foreground/20' : 'hover:bg-border'
            }`}
          >
            <Icon name={nodeActionIcon ?? 'plus'} size="xs" className="text-inherit" />
          </Box>
        )}
      </Box>
      {hasChildren && expanded && (
        <Box role="group">
          {children!.map(child => (
            <FlatTreeNodeItem
              key={child.id}
              item={child}
              depth={depth + 1}
              indent={indent}
              childrenByParent={childrenByParent}
              roots={roots}
              onNodeSelect={onNodeSelect}
              onNodeAction={onNodeAction}
              nodeActionIcon={nodeActionIcon}
              nodeActionLabel={nodeActionLabel}
              onNodeReorder={onNodeReorder}
              selectedId={selectedId}
              look={look}
              isExpanded={isExpanded}
              onToggle={onToggle}
            />
          ))}
        </Box>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

/** Ancestor chain of `id` following parentId links (cycle-safe). */
function ancestorsOf(id: string | undefined, byId: Map<string, FileTreeItem>): Set<string> {
  const out = new Set<string>();
  if (!id) return out;
  let cur = byId.get(id)?.parentId;
  while (cur && byId.has(cur) && !out.has(cur)) {
    out.add(cur);
    cur = byId.get(cur)?.parentId;
  }
  return out;
}

const FlatFileTree: React.FC<Omit<FileTreeProps, 'tree' | 'selectedPath' | 'onFileSelect'> & { items: FileTreeItem[] }> = ({
  items,
  selectedId,
  expandedPaths,
  look = 'files',
  onNodeSelect,
  onNodeAction,
  nodeActionIcon,
  nodeActionLabel,
  onNodeReorder,
  className,
  indent = 16,
  ...rest
}) => {
  // Fold state: explicit per-node overrides on top of the derived default
  // (roots open, deeper closed, the selection's ancestors and the listed
  // expandedPaths open). A changed selection or list clears overrides on what
  // it newly opens so "where am I" always wins over a stale manual collapse.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const byId = React.useMemo(() => new Map(items.map(node => [node.id, node])), [items]);
  const selectedAncestors = React.useMemo(() => ancestorsOf(selectedId, byId), [selectedId, byId]);
  const listedKey = (expandedPaths ?? []).join('\n');
  const listed = React.useMemo(() => new Set(expandedPaths ?? []), [listedKey]);
  const lastRevealRef = React.useRef(`${selectedId ?? ''}\u0000${listedKey}`);
  React.useEffect(() => {
    const reveal = `${selectedId ?? ''}\u0000${listedKey}`;
    if (reveal === lastRevealRef.current) return;
    lastRevealRef.current = reveal;
    const opened = [...selectedAncestors, ...listed];
    setOverrides(prev => {
      if (!opened.some(a => prev.get(a) === false)) return prev;
      const next = new Map(prev);
      for (const a of opened) if (next.get(a) === false) next.delete(a);
      return next;
    });
  }, [selectedId, selectedAncestors, listedKey, listed]);

  const isExpanded = useCallback(
    (id: string, depth: number) => overrides.get(id) ?? (depth < 1 || selectedAncestors.has(id) || listed.has(id)),
    [overrides, selectedAncestors, listed],
  );
  const onToggle = useCallback((id: string, effective: boolean) => {
    setOverrides(prev => {
      const next = new Map(prev);
      next.set(id, !effective);
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  // Flat -> nested: group by parentId; a parentId with no matching row
  // (orphan) renders that node as a root instead of vanishing.
  const ids = new Set(items.map(node => node.id));
  const childrenByParent = new Map<string, FileTreeItem[]>();
  const roots: FileTreeItem[] = [];
  for (const item of items) {
    if (item.parentId && ids.has(item.parentId)) {
      const siblings = childrenByParent.get(item.parentId);
      if (siblings) siblings.push(item);
      else childrenByParent.set(item.parentId, [item]);
    } else {
      roots.push(item);
    }
  }

  return (
    <TreeRoot defaultKey={roots[0]?.id} className={className} rest={rest}>
      {roots.map(item => (
        <FlatTreeNodeItem
          key={item.id}
          item={item}
          depth={0}
          indent={indent}
          childrenByParent={childrenByParent}
          roots={roots}
          onNodeSelect={onNodeSelect}
          onNodeAction={onNodeAction}
          nodeActionIcon={nodeActionIcon}
          nodeActionLabel={nodeActionLabel}
          onNodeReorder={onNodeReorder}
          selectedId={selectedId}
          look={look}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      ))}
    </TreeRoot>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({
  tree,
  items,
  selectedPath,
  selectedId,
  look = 'files',
  onFileSelect,
  onNodeExpand,
  expandedPaths,
  onNodeSelect,
  onNodeAction,
  nodeActionIcon,
  nodeActionLabel,
  onNodeReorder,
  className,
  indent = 16,
  ...rest
}) => {
  if (items) {
    return (
      <FlatFileTree
        {...rest}
        items={items}
        selectedId={selectedId}
        expandedPaths={expandedPaths}
        look={look}
        onNodeSelect={onNodeSelect}
        onNodeAction={onNodeAction}
        nodeActionIcon={nodeActionIcon}
        nodeActionLabel={nodeActionLabel}
        onNodeReorder={onNodeReorder}
        className={className}
        indent={indent}
      />
    );
  }

  // An optional tree region renders nothing when empty rather than an empty-state
  // block: consumers that don't supply a tree (std-wiki) otherwise get a dead
  // ~100px "No files" panel under a heading that reports a non-zero count.
  if (!tree || tree.length === 0) return null;

  return (
    <TreeRoot defaultKey={tree[0]?.path} className={className} rest={rest}>
      {tree.map(node => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          indent={indent}
          selectedPath={selectedPath}
          onFileSelect={onFileSelect}
          onNodeExpand={onNodeExpand}
          expandedPaths={expandedPaths}
          defaultExpanded
        />
      ))}
    </TreeRoot>
  );
};

FileTree.displayName = 'FileTree';
