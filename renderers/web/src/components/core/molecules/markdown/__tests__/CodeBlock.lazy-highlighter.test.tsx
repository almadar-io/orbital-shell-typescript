/**
 * The highlighter loads on demand (G-UI-105): a block shows its code as plain monospace first, then paints
 * highlighted once the highlighter arrives. Its own file, so no other test has loaded the highlighter yet.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { CodeBlock } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <EventBusProvider debug={false}>{children}</EventBusProvider>;
}

const CODE = '{ "orbital": "Notes", "count": 2 }';

describe('CodeBlock loads its highlighter on demand', () => {
  it('shows the code as plain text first, then highlighted', async () => {
    const { container } = render(<Wrapper><CodeBlock code={CODE} language="json" /></Wrapper>);
    expect(container.textContent).toContain('"orbital"');
    expect(container.querySelectorAll('span.token')).toHaveLength(0);
    await waitFor(() => expect(container.querySelectorAll('span.token').length).toBeGreaterThan(1));
    expect(container.textContent).toContain('"orbital"');
  });

  it('control: a block mounted after the highlighter is in paints highlighted at once', () => {
    const { container } = render(<Wrapper><CodeBlock code={CODE} language="json" /></Wrapper>);
    expect(container.querySelectorAll('span.token').length).toBeGreaterThan(1);
  });
});
