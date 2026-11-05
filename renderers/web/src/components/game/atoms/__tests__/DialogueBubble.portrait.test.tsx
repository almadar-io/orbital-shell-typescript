import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DialogueBubble } from '../DialogueBubble';

describe('DialogueBubble portrait contract', () => {
  it('omits the portrait when the authored prop is absent', () => {
    render(<DialogueBubble text="Ready" speaker="Guide" />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('reveals authored Unicode characters rather than UTF-16 units', () => {
    render(<DialogueBubble text="A😀B" speaker="Guide" revealedChars={2} />);
    expect(screen.getByText('A😀')).toBeInTheDocument();
    expect(screen.queryByText('A😀B')).not.toBeInTheDocument();
  });
});
