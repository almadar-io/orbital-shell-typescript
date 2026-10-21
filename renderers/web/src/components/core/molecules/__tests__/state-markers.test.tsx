// @vitest-environment jsdom
/**
 * Empty and loading views carry a declared DOM marker, so a verifier can find
 * an empty collection or a still-spinning view without reading its text
 * (G-VERIFY-051: "No events" and "Loading stock levels…" slipped past every gate).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EMPTY_STATE_MARKER, LOADING_STATE_MARKER } from '@almadar/core';
import { EmptyState } from '../EmptyState';
import { LoadingState } from '../LoadingState';
import { Spinner } from '../../../../core';

describe('state markers', () => {
  it('EmptyState marks its root', () => {
    const { container } = render(<EmptyState title="No events" />);
    expect(container.querySelector(`[${EMPTY_STATE_MARKER}]`)).not.toBeNull();
  });

  it('LoadingState and Spinner mark theirs', () => {
    expect(render(<LoadingState />).container.querySelector(`[${LOADING_STATE_MARKER}]`)).not.toBeNull();
    expect(render(<Spinner />).container.querySelector(`[${LOADING_STATE_MARKER}]`)).not.toBeNull();
  });

  it('control: a loading view is not marked empty, an empty view is not marked loading', () => {
    expect(render(<LoadingState />).container.querySelector(`[${EMPTY_STATE_MARKER}]`)).toBeNull();
    expect(render(<EmptyState title="x" />).container.querySelector(`[${LOADING_STATE_MARKER}]`)).toBeNull();
  });
});
