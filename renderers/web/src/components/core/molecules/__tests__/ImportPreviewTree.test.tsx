/**
 * ImportPreviewTree Component Tests
 *
 * Tests for entity grouping, parentRef nesting, field summaries,
 * skipped elements, and confirm/cancel callbacks.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportPreviewTree, type ImportPreviewUnit } from '../import/ImportPreviewTree';
import { EventBusProvider } from '../../../../core';
import { MemoryRouter } from 'react-router-dom';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <EventBusProvider debug={false}>{children}</EventBusProvider>
  </MemoryRouter>
);

const units: ImportPreviewUnit[] = [
  { ref: 'u1', targetEntity: 'Concept', title: 'Algebra', fields: { content: 'Math notes' } },
  { ref: 'u2', targetEntity: 'Concept', parentRef: 'u1', title: 'Linear equations', fields: {} },
  { ref: 'u3', targetEntity: 'FlashCard', fields: { question: 'What is x?', answer: 'A variable' } },
];

const entityDisplay = {
  Concept: { singular: 'Concept', plural: 'Concepts' },
};

describe('ImportPreviewTree', () => {
  it('groups units by entity with display labels and fallback names', () => {
    render(
      <TestWrapper>
        <ImportPreviewTree units={units} entityDisplay={entityDisplay} />
      </TestWrapper>
    );

    expect(screen.getByText('Concepts')).toBeTruthy();
    expect(screen.getByText('FlashCard')).toBeTruthy();
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.getByText('Linear equations')).toBeTruthy();
    expect(screen.getByText('u3')).toBeTruthy();
    expect(screen.getByText('question: What is x? · answer: A variable')).toBeTruthy();
  });

  it('nests units under their parentRef with indentation', () => {
    render(
      <TestWrapper>
        <ImportPreviewTree units={units} entityDisplay={entityDisplay} />
      </TestWrapper>
    );

    const child = screen.getByTestId('import-preview-unit-u2');
    expect((child as HTMLElement).style.paddingLeft).toBe('16px');
  });

  it('summarizes the unit fields', () => {
    render(
      <TestWrapper>
        <ImportPreviewTree units={units} entityDisplay={entityDisplay} />
      </TestWrapper>
    );

    expect(screen.getByText('content: Math notes')).toBeTruthy();
  });

  it('lists skipped elements with their reasons', () => {
    render(
      <TestWrapper>
        <ImportPreviewTree
          units={units}
          skipped={[{ ref: 'u9', reason: 'unmappable structure' }]}
          entityDisplay={entityDisplay}
        />
      </TestWrapper>
    );

    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.getByText('u9')).toBeTruthy();
    expect(screen.getByText('unmappable structure')).toBeTruthy();
  });

  it('calls onConfirm and onCancel from the footer buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <TestWrapper>
        <ImportPreviewTree
          units={units}
          entityDisplay={entityDisplay}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Confirm import'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ImportPreviewTree unit headings are declared', () => {
  it('shows the declared title', () => {
    render(<TestWrapper><ImportPreviewTree units={[{ ref: 'u1', targetEntity: 'Product', title: 'Blue mug', fields: { price: 12 } }]} entityDisplay={entityDisplay} /></TestWrapper>);
    expect(screen.getByText('Blue mug')).toBeTruthy();
  });

  it('control: a field named "name" is not taken as the heading and stays in the summary', () => {
    render(<TestWrapper><ImportPreviewTree units={[{ ref: 'u1', targetEntity: 'Product', fields: { name: 'Blue mug' } }]} entityDisplay={entityDisplay} /></TestWrapper>);
    expect(screen.getByText('u1')).toBeTruthy();
    expect(screen.getByText(/name: Blue mug/)).toBeTruthy();
  });
});
