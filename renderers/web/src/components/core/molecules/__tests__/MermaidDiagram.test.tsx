/**
 * MermaidDiagram Component Tests
 *
 * The mermaid library is mocked — jsdom can't run its real SVG layout.
 * Covers: successful render injection, the repair retry (a source mermaid rejects
 * rendering through an accepted candidate), degradation to the source when nothing
 * parses, recovery after a corrected source, and the MarkdownContent +
 * SegmentRenderer routing of ```mermaid fences / mermaid code segments.
 * Whether a candidate is ACCEPTED is mermaid's call — proved against the real
 * parser in mermaidGrammar.test.ts, not here.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MermaidDiagram } from '../markdown/MermaidDiagram';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { SegmentRenderer } from '../../organisms/SegmentRenderer';
import { EventBusProvider } from '../../../../core';

const initialize = vi.fn();
const renderDiagram = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => renderDiagram(...args) as Promise<{ svg: string }>,
  },
}));

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

const GRAPH = 'graph TD\n  A --> B';

describe('MermaidDiagram', () => {
  beforeEach(() => {
    initialize.mockReset();
    renderDiagram.mockReset();
    renderDiagram.mockResolvedValue({ svg: '<svg data-diagram="ok"><g>A→B</g></svg>' });
  });

  it('renders the SVG returned by mermaid.render', async () => {
    render(<MermaidDiagram code={GRAPH} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram').innerHTML).toContain('data-diagram="ok"');
    });
    expect(renderDiagram).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), GRAPH);
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict' }),
    );
  });

  it('renders a repair candidate when mermaid rejects the original source', async () => {
    const BROKEN = 'graph TD\n  A[Scripting Engine (Vimscript)] --> B[Ok]';
    renderDiagram.mockRejectedValueOnce(new Error('Parse error on line 2'));
    render(<MermaidDiagram code={BROKEN} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram').innerHTML).toContain('data-diagram="ok"');
    });
    // The retry carried the quoted label, and the container records the repair.
    expect(renderDiagram).toHaveBeenLastCalledWith(
      expect.stringMatching(/^mermaid-/),
      expect.stringContaining('A["Scripting Engine (Vimscript)"]'),
    );
    expect(screen.getByTestId('mermaid-diagram').dataset.mermaidRepaired).toBe('true');
    expect(screen.queryByTestId('mermaid-unrenderable')).not.toBeInTheDocument();
  });

  it('marks a first-attempt render as not repaired', async () => {
    render(<MermaidDiagram code={GRAPH} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram').dataset.mermaidRepaired).toBe('false');
    });
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it('shows the source, not the parser error, when no candidate parses', async () => {
    renderDiagram.mockRejectedValue(new Error("Parse error on line 2 ... Expecting 'SQE', 'PE'"));
    render(<MermaidDiagram code="graph TD\n  A[Broken (x)] -->" />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-unrenderable')).toBeInTheDocument();
    });
    expect(screen.getByText(/could not be displayed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Parse error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SQE/)).not.toBeInTheDocument();
    expect(screen.getByTestId('mermaid-diagram')).not.toBeVisible();
  });

  it('does not retry a diagram type it has no grammar for', async () => {
    renderDiagram.mockRejectedValue(new Error('Parse error'));
    render(<MermaidDiagram code="sequenceDiagram\n  Alice->>John: Hi (there)" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('mermaid-unrenderable')).toBeInTheDocument();
    });
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it('recovers when the source is corrected', async () => {
    renderDiagram.mockRejectedValue(new Error('Parse error'));
    const { rerender } = render(<MermaidDiagram code="graph TD\n  A -->" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('mermaid-unrenderable')).toBeInTheDocument());

    renderDiagram.mockReset();
    renderDiagram.mockResolvedValue({ svg: '<svg data-diagram="ok"><g>A→B</g></svg>' });
    rerender(<MermaidDiagram code={GRAPH} />);
    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram').innerHTML).toContain('data-diagram="ok"');
    });
    expect(screen.queryByTestId('mermaid-unrenderable')).not.toBeInTheDocument();
  });

  it('is routed from a ```mermaid fence in MarkdownContent', async () => {
    render(
      <MarkdownContent content={'Before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter'} />,
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram').innerHTML).toContain('data-diagram="ok"');
    });
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('is routed from a mermaid code segment in SegmentRenderer', async () => {
    render(
      <SegmentRenderer segments={[{ type: 'code', language: 'mermaid', content: GRAPH }]} />,
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram').innerHTML).toContain('data-diagram="ok"');
    });
  });
});

describe('MermaidDiagram theme', () => {
  beforeEach(() => {
    initialize.mockReset();
    renderDiagram.mockReset();
    renderDiagram.mockResolvedValue({ svg: '<svg data-diagram="ok"></svg>' });
  });

  // jsdom computes custom properties only where a rule or inline style declares them (no inheritance).
  const themed = (fill: string, ground: string) => (
    <>
      <style>{`[data-testid="mermaid-diagram"] { --color-diagram-fill: ${fill}; --surface-diagram: ${ground}; }`}</style>
      <MermaidDiagram code={GRAPH} />
    </>
  );

  it('draws with the base theme and the variables resolved from its scope', async () => {
    render(themed('rgb(224, 240, 241)', 'rgb(250, 249, 246)'), { wrapper: Wrapper });
    await waitFor(() => expect(renderDiagram).toHaveBeenCalled());
    const config = initialize.mock.calls.at(-1)?.[0] as { theme: string; themeVariables: { primaryColor: string; background: string } };
    expect(config.theme).toBe('base');
    expect(config.themeVariables.primaryColor).toBe('rgb(224, 240, 241)');
    expect(config.themeVariables.background).toBe('rgb(250, 249, 246)');
  });

  it('control: another scope draws with its own colors', async () => {
    render(themed('rgb(10, 20, 30)', 'rgb(0, 0, 0)'), { wrapper: Wrapper });
    await waitFor(() => expect(renderDiagram).toHaveBeenCalled());
    const config = initialize.mock.calls.at(-1)?.[0] as { themeVariables: { primaryColor: string } };
    expect(config.themeVariables.primaryColor).toBe('rgb(10, 20, 30)');
  });
});
