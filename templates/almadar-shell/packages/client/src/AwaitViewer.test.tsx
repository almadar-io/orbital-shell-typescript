// @vitest-environment jsdom
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { ViewerAuthority } from '@almadar/core';
import { AwaitViewer } from './AwaitViewer';

function probe(mounts: string[], viewer: string) {
  return function Probe(): null {
    useEffect(() => {
      mounts.push(viewer);
    }, []);
    return null;
  };
}

describe('AwaitViewer', () => {
  it('mounts once with the restored viewer and never anonymously while the sign-in restores', () => {
    const mounts: string[] = [];
    const Anonymous = probe(mounts, 'anonymous');
    const Maya = probe(mounts, 'maya');
    const view = render(<AwaitViewer authority="pending"><Anonymous /></AwaitViewer>);
    expect(mounts).toEqual([]);
    view.rerender(<AwaitViewer authority="authenticated"><Maya /></AwaitViewer>);
    expect(mounts).toEqual(['maya']);
  });

  it.each<ViewerAuthority>(['anonymous', 'unavailable', 'failed'])('control: %s mounts at once', (authority) => {
    const mounts: string[] = [];
    const Page = probe(mounts, authority);
    render(<AwaitViewer authority={authority}><Page /></AwaitViewer>);
    expect(mounts).toEqual([authority]);
  });
});
