// G-ORB-308 (owner ruling 2026-10-16: no JS `os/`): the Node host never answers an `os` ask itself, whatever its options.
// The fixture program asks `os/spawn`; an answered ask runs its hook to the 200 branch, an unsupported one to the 500 branch.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KernelProgram, resolveProgramFile, type KernelProgramOptions } from '../src/index.js';

const program = fileURLToPath(new URL('./fixtures/late-answer/late-answer.lolo', import.meta.url));
const base: KernelProgramOptions = { languageFrom: fileURLToPath(new URL('..', import.meta.url)) };
// The retired `os: true` option, spread in so a caller that still passes it is covered without a typed property.
const retiredOsOption = { os: true };

async function answerWith(options: KernelProgramOptions) {
  const p = await KernelProgram.open(await resolveProgramFile(program, process.cwd()), options);
  try {
    return await p.deliverInbound('cli-echo', { headers: {}, rawBody: '{}' });
  } finally {
    p.close();
  }
}

describe('the Node host and os asks', () => {
  it('answers an os ask unsupported when built with the retired os: true option', async () => {
    expect(await answerWith({ ...base, ...retiredOsOption })).toEqual({ status: 500, body: '{"ok":false}' });
  }, 20_000);

  it('answers an os ask unsupported when built with no os option', async () => {
    expect(await answerWith(base)).toEqual({ status: 500, body: '{"ok":false}' });
  }, 20_000);
});
