/**
 * G-UI-017: the generated `ui-code-block` wrapper forwards its empty defaults
 * (`files: []`, `diff: []`); an empty collection must count as unset, so the
 * block still shows its `code`.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CodeBlock } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

const CODE = 'const answer = 42;';

function shows(props: React.ComponentProps<typeof CodeBlock>) {
  const { container } = render(<EventBusProvider debug={false}><CodeBlock {...props} /></EventBusProvider>);
  return container;
}

describe('CodeBlock with empty collections', () => {
  it.each([
    ['no collections', {}],
    ['files: []', { files: [] }],
    ['diff: []', { diff: [] }],
    ['files: [] and diff: []', { files: [], diff: [] }],
  ])('%s shows the code', async (_label, extra) => {
    const container = shows({ code: CODE, language: 'javascript', ...extra });
    await waitFor(() => expect(container.textContent).toContain('answer'));
  });

  it('control: a real diff still renders as a diff', async () => {
    const container = shows({ code: '', language: 'javascript', diff: [{ type: 'add', content: 'added line' }] });
    await waitFor(() => expect(container.textContent).toContain('added line'));
  });
});
