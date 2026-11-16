import { describe, expect, it } from 'vitest';
import { createProgramKernel } from '../programKernel';

interface FakeKernel { id: string }
interface Probe { kernel: FakeKernel; made: number; loaded: string[] }

function probe(): Probe {
  return { kernel: { id: 'program' }, made: 0, loaded: [] };
}

function opener(p: Probe, failOn?: string) {
  const program = createProgramKernel<FakeKernel>();
  return (key: string) => program.open(
    key,
    async () => { p.made += 1; return p.kernel; },
    () => {
      if (key === failOn) throw new Error(`${key} did not load`);
      p.loaded.push(key);
    },
  );
}

describe('createProgramKernel', () => {
  it('builds one kernel for the first page and loads each later page into it once', async () => {
    const p = probe();
    const open = opener(p);
    const site = await open('Site');
    const quickstart = await open('Quickstart');
    const again = await open('Quickstart');
    const introduction = await open('Introduction');
    expect([site, quickstart, again, introduction].every((k) => k === p.kernel)).toBe(true);
    expect(p.made).toBe(1);
    expect(p.loaded).toEqual(['Quickstart', 'Introduction']);
  });

  it('control: two programs build two kernels', async () => {
    const p = probe();
    await opener(p)('Site');
    await opener(p)('Site');
    expect(p.made).toBe(2);
  });

  it('edge: a page that fails to load fails alone and the next page still loads', async () => {
    const p = probe();
    const open = opener(p, 'Broken');
    await open('Site');
    await expect(open('Broken')).rejects.toThrow('Broken did not load');
    await expect(open('Introduction')).resolves.toBe(p.kernel);
    expect(p.loaded).toEqual(['Introduction']);
  });
});
