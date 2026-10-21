/**
 * A copy button alone does not earn a header bar: with no language badge the
 * button floats over the code box instead of sitting in an empty strip.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeBlock } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

function mount(props: Partial<React.ComponentProps<typeof CodeBlock>>) {
  return render(
    <EventBusProvider debug={false}>
      <CodeBlock code="curl -fsSL https://orb.almadar.io/install.sh | sh" language="bash" {...props} />
    </EventBusProvider>,
  );
}

describe('CodeBlock header bar', () => {
  it('copy button without a language badge renders no header bar, and the button is still there', () => {
    const { container } = mount({ showLanguageBadge: false, showCopyButton: true });
    expect(container.querySelector('[data-testid="code-block-header"]')).toBeNull();
    expect(screen.getByRole('button', { name: /copy/i }).closest('.rounded-t-container')).toBeNull();
  });

  it('control: a language badge keeps the header bar with the badge and the copy button', () => {
    const { container } = mount({ showLanguageBadge: true, showCopyButton: true });
    const header = container.querySelector('[data-testid="code-block-header"]');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain('bash');
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });

  it('control: neither badge nor copy renders no header and no copy button', () => {
    const { container } = mount({ showLanguageBadge: false, showCopyButton: false });
    expect(container.querySelector('[data-testid="code-block-header"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });
});
