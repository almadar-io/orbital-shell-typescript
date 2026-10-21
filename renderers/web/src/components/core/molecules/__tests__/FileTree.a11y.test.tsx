import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileTree, type FileTreeNode, type FileTreeItem } from '../FileTree';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const tree: FileTreeNode[] = [
  {
    name: 'src', path: 'src', type: 'dir',
    children: [
      { name: 'a.ts', path: 'src/a.ts', type: 'file' },
      { name: 'b.ts', path: 'src/b.ts', type: 'file' },
    ],
  },
  { name: 'Note.lolo', path: 'Note.lolo', type: 'file', children: [{ name: 'Note.orb', path: 'Note.orb', type: 'file' }] },
  { name: 'readme.md', path: 'readme.md', type: 'file' },
];

const row = (label: string) => screen.getByText(label).closest('[role="treeitem"]') as HTMLElement;

describe('FileTree a11y', () => {
  it('has no axe violations and a single tab stop', async () => {
    const { container } = render(<FileTree tree={tree} aria-label="Files" />);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe('Files');
    const stops = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(row('src'));
  });

  it('exposes level and expanded state on folders only', () => {
    render(<FileTree tree={tree} />);
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    expect(row('src').getAttribute('aria-level')).toBe('1');
    expect(row('a.ts').getAttribute('aria-level')).toBe('2');
    expect(row('a.ts').hasAttribute('aria-expanded')).toBe(false);
    expect(row('readme.md').hasAttribute('aria-expanded')).toBe(false);
  });

  it('moves focus with arrows, Home and End and rolls the tab stop', () => {
    render(<FileTree tree={tree} />);
    row('src').focus();
    fireEvent.keyDown(row('src'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row('a.ts'));
    expect(row('a.ts').getAttribute('tabindex')).toBe('0');
    expect(row('src').getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(row('a.ts'), { key: 'End' });
    expect(document.activeElement).toBe(row('readme.md'));
    fireEvent.keyDown(row('readme.md'), { key: 'Home' });
    expect(document.activeElement).toBe(row('src'));
    fireEvent.keyDown(row('src'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(row('src'));
  });

  it('ArrowLeft collapses an open folder, then ArrowRight reopens and enters it', () => {
    render(<FileTree tree={tree} />);
    row('src').focus();
    fireEvent.keyDown(row('src'), { key: 'ArrowLeft' });
    expect(row('src').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('a.ts')).toBeNull();
    fireEvent.keyDown(row('src'), { key: 'ArrowRight' });
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(row('src'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(row('a.ts'));
    fireEvent.keyDown(row('a.ts'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(row('src'));
  });

  it('Enter and Space activate a file; keys on other targets do not', () => {
    const onFileSelect = vi.fn();
    render(<FileTree tree={tree} onFileSelect={onFileSelect} />);
    fireEvent.keyDown(row('readme.md'), { key: 'Enter' });
    fireEvent.keyDown(row('a.ts'), { key: ' ' });
    expect(onFileSelect).toHaveBeenCalledWith('readme.md');
    expect(onFileSelect).toHaveBeenCalledWith('src/a.ts');
    fireEvent.keyDown(row('a.ts'), { key: 'x' });
    expect(onFileSelect).toHaveBeenCalledTimes(2);
  });

  it('a file with derived children toggles by keyboard and by a named toggle', () => {
    render(<FileTree tree={tree} />);
    expect(row('Note.lolo').getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(row('Note.lolo'), { key: 'ArrowRight' });
    expect(screen.getByText('Note.orb')).toBeTruthy();
    const toggle = screen.getByTestId('file-tree-toggle-Note.lolo');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse');
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(screen.queryByText('Note.orb')).toBeNull();
  });

  it('flat items mode: keyboard nav, named chevron and action, axe clean', async () => {
    const items: FileTreeItem[] = [
      { id: 'r1', label: 'Root 1' },
      { id: 'c1', label: 'Child 1', parentId: 'r1' },
      { id: 'r2', label: 'Root 2' },
    ];
    const onNodeSelect = vi.fn();
    const onNodeAction = vi.fn();
    const { container } = render(
      <FileTree items={items} onNodeSelect={onNodeSelect} onNodeAction={onNodeAction} nodeActionLabel="Add" />,
    );
    expect(describeViolations(await axeViolations(container))).toEqual([]);
    row('Root 1').focus();
    fireEvent.keyDown(row('Root 1'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row('Child 1'));
    fireEvent.keyDown(row('Child 1'), { key: 'Enter' });
    expect(onNodeSelect).toHaveBeenCalledWith('c1');
    const addButtons = screen.getAllByLabelText('Add');
    fireEvent.keyDown(addButtons[0], { key: 'Enter' });
    expect(onNodeAction).toHaveBeenCalledTimes(1);
    expect(onNodeSelect).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for an empty tree', () => {
    const { container } = render(<FileTree tree={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
