'use client';

import React from 'react';

export interface AvlExprTreeNode {
  label: string;
  type: 'operator' | 'literal' | 'binding';
  children?: AvlExprTreeNode[];
}

export interface AvlExprTreeProps {
  expression: AvlExprTreeNode;
  className?: string;
  color?: string;
  animated?: boolean;
}

let avlEtId = 0;

interface LayoutNode {
  label: string;
  type: 'operator' | 'literal' | 'binding';
  x: number;
  y: number;
  children: LayoutNode[];
}

function layoutTree(node: AvlExprTreeNode, x: number, y: number, hSpacing: number, vSpacing: number): LayoutNode {
  const children = node.children ?? [];
  if (children.length === 0) {
    return { label: node.label, type: node.type, x, y, children: [] };
  }

  const totalWidth = (children.length - 1) * hSpacing;
  const startX = x - totalWidth / 2;

  const layoutChildren = children.map((child, i) =>
    layoutTree(child, startX + i * hSpacing, y + vSpacing, hSpacing * 0.85, vSpacing)
  );

  return { label: node.label, type: node.type, x, y, children: layoutChildren };
}

function nodeColor(type: 'operator' | 'literal' | 'binding', baseColor: string): string {
  switch (type) {
    case 'operator': return baseColor;
    case 'literal': return baseColor;
    case 'binding': return baseColor;
  }
}

function renderNode(node: LayoutNode, color: string, glowId: string): React.ReactNode {
  // Size nodes based on label length for readability
  const labelLen = node.label.length;
  const baseR = node.type === 'operator' ? 20 : 16;
  const r = Math.max(baseR, labelLen * 3.5 + 6);
  const nc = nodeColor(node.type, color);

  return (
    <React.Fragment key={`${node.label}-${node.x}-${node.y}`}>
      {/* Lines to children */}
      {node.children.map((child, i) => {
        const childR = Math.max(
          child.type === 'operator' ? 20 : 16,
          child.label.length * 3.5 + 6,
        );
        return (
          <line
            key={`line-${i}`}
            x1={node.x}
            y1={node.y + (node.type === 'operator' ? r * 0.7 : r)}
            x2={child.x}
            y2={child.y - (child.type === 'operator' ? childR * 0.7 : childR)}
            stroke={color}
            strokeWidth={1}
            opacity={0.3}
          />
        );
      })}

      {/* Node shape */}
      {node.type === 'operator' ? (
        <rect
          x={node.x - r}
          y={node.y - r * 0.6}
          width={r * 2}
          height={r * 1.2}
          rx={4}
          ry={4}
          fill={color}
          fillOpacity={0.15}
          stroke={nc}
          strokeWidth={1.5}
        />
      ) : node.type === 'binding' ? (
        <circle cx={node.x} cy={node.y} r={r} fill="none" stroke={nc} strokeWidth={1.5} strokeDasharray="3 2" />
      ) : (
        <circle cx={node.x} cy={node.y} r={r} fill="none" stroke={nc} strokeWidth={1} opacity={0.5} />
      )}

      {/* Label - binding gets @ prefix inline */}
      <text
        x={node.x}
        y={node.y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={nc}
        fontSize={node.type === 'operator' ? 11 : 10}
        fontFamily="inherit"
        fontWeight={node.type === 'operator' ? 'bold' : 'normal'}
      >
        {node.type === 'binding' && !node.label.startsWith('@') ? `@${node.label}` : node.label}
      </text>

      {/* Recurse children */}
      {node.children.map((child) => renderNode(child, color, glowId))}
    </React.Fragment>
  );
}

export const AvlExprTree: React.FC<AvlExprTreeProps> = ({
  expression,
  className,
  color = 'var(--color-primary)',
}) => {
  const ids = React.useMemo(() => {
    avlEtId += 1;
    return { glow: `avl-et-${avlEtId}-glow` };
  }, []);

  const layout = layoutTree(expression, 400, 60, 280, 100);

  return (
    <svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {renderNode(layout, color, ids.glow)}
    </svg>
  );
};

AvlExprTree.displayName = 'AvlExprTree';
