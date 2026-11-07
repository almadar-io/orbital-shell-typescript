import { describe, expect, it } from 'vitest';
import { safelistEntryLine } from '../scripts/lib/safelist-entry.mjs';

describe('G-ORBITAL-SHELL-TYPESCRIPT-034 safelist entry quoting', () => {
  it('writes a class holding single quotes as a string that evaluates back to the class', () => {
    const cls = "after:content-['']";
    const line = safelistEntryLine(cls);
    expect(new Function(`return [${line}]`)()).toEqual([cls]);
  });

  it('keeps the single-quoted form for a plain class', () => {
    expect(safelistEntryLine('bg-primary/10')).toBe("  'bg-primary/10',");
  });
});
