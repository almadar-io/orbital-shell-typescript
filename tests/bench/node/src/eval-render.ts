/**
 * The cost of the kernel's per-argument type check on a form render: twenty bindings of common operators evaluated in
 * one `evaluateMany` crossing, with and without the operator table installed. Run: `ALMADAR_KERNEL_DIR=… pnpm exec tsx src/eval-render.ts`.
 * `ALMADAR_KERNEL_DIR` is the `@almadar/kernel` package directory (`orbital-rust/crates/orbital-wasm/js`); the language data
 * is read from the workspace.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLanguageBundle } from '@almadar/core/language-data';
import type { SExpr } from '@almadar/core';

interface KernelModule {
  initSync(init: { module: Buffer }): void;
  installLanguage(bundleJson: string): void;
  evaluateMany(contextJson: string, expressionsJson: string): string;
}

const kernelDir = process.env.ALMADAR_KERNEL_DIR;
if (kernelDir === undefined) throw new Error('eval-render: ALMADAR_KERNEL_DIR must name the @almadar/kernel package directory');
const kernel: KernelModule = await import(pathToFileURL(join(kernelDir, 'pkg/orbital_wasm.js')).href);

const entity = {
  a: 3, count: 5, name: 'Ann', surname: 'Lee', status: 'open', total: 1234.5, items: [1, 2, 3], tags: ['x', 'y'],
  price: 9.5, qty: 4, title: 'Hello World', note: 'abc', flag: true, score: 0.75,
};

const bindings: SExpr[] = [
  ['+', '@entity.a', 1], ['str/concat', '@entity.name', ' ', '@entity.surname'], ['=', '@entity.status', 'open'],
  ['array/len', '@entity.items'], ['if', ['>', '@entity.count', 3], 'many', 'few'], ['*', '@entity.price', '@entity.qty'],
  ['str/upper', '@entity.title'], ['array/first', '@entity.items'], ['and', '@entity.flag', ['<', '@entity.score', 1]],
  ['math/round', ['*', '@entity.score', 100]], ['str/len', '@entity.note'], ['array/includes', '@entity.tags', 'x'],
  ['-', '@entity.total', '@entity.price'], ['str/truncate', '@entity.title', 5],
  ['array/map', '@entity.items', ['fn', 'i', ['+', '@i', 1]]], ['not', '@entity.flag'], ['!=', '@entity.name', 'Bob'],
  ['math/max', '@entity.a', '@entity.qty'], ['array/sum', '@entity.items'], ['str/lower', '@entity.name'],
];

function bestMicroseconds(context: string, expressions: string): number {
  for (let i = 0; i < 3000; i++) kernel.evaluateMany(context, expressions);
  let best = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 5; round++) {
    const runs = 20000;
    const started = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) kernel.evaluateMany(context, expressions);
    best = Math.min(best, Number(process.hrtime.bigint() - started) / 1000 / runs);
  }
  return best;
}

kernel.initSync({ module: readFileSync(join(kernelDir, 'pkg/orbital_wasm_bg.wasm')) });
const context = JSON.stringify({ entity, payload: {}, state: 'idle', now: 1700000000000 });
const expressions = JSON.stringify(bindings);
const bare = bestMicroseconds(context, expressions);
kernel.installLanguage(JSON.stringify(readLanguageBundle(process.cwd())));
const typed = bestMicroseconds(context, expressions);
console.log(`20-binding render: ${bare.toFixed(1)} us without the operator table, ${typed.toFixed(1)} us with it (the type check is ${(((typed - bare) / typed) * 100).toFixed(0)}% of the render)`);
