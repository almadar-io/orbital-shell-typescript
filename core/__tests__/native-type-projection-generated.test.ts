import ts from 'typescript';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function checkProjection(path: string, source: string): readonly ts.Diagnostic[] {
  const entry = join(dirname(path), 'type-projection-control.ts');
  const options: ts.CompilerOptions = { strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, resolveJsonModule: true };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, shouldCreateNewSourceFile) => file === entry
    ? ts.createSourceFile(file, source, ts.ScriptTarget.ES2020, true)
    : original(file, version, onError, shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram([entry], options, host));
}

for (const mode of ['wire', 'hostInput']) {
  const path = mode === 'wire' ? process.env.ORBITAL_TYPE_PROJECTION_WIRE_TYPES : process.env.ORBITAL_TYPE_PROJECTION_HOST_TYPES;
  describe.skipIf(!path)(`actual generated ${mode} projection`, () => {
    it('keeps date array positions distinct from scalar strings and ordinary fixed strings', () => {
      if (!path) throw new Error('actual backend-emitted Date/Map projection types path is required');
      const source = `import type { Dates, Fixed } from ${JSON.stringify(path)};
const valid: Dates = { today: [${mode === 'hostInput' ? "new Date('2020-01-02'), " : ''}'2020-01-02', 0]${mode === 'hostInput' ? ', omitted: undefined' : ''} };
const fixed: Fixed = 'ordinary string';
// @ts-expect-error an array position cannot be a scalar string
const scalar: Dates = { today: '2020-01-02' };
// @ts-expect-error array members are required values
const undefinedItem: Dates = { today: [undefined] };
// @ts-expect-error ordinary string is not widened to Date
const fixedDate: Fixed = new Date('2020-01-02');
${mode === 'wire' ? "// @ts-expect-error JSON wire maps have no explicit undefined values\nconst undefinedMapValue: Dates = { today: undefined };\n// @ts-expect-error dates serialize before the wire boundary\nconst wireDate: Dates = { today: [new Date('2020-01-02')] };" : ''}
void [valid, fixed, scalar, undefinedItem, fixedDate];`;
      const errors = checkProjection(path, source).map((diagnostic) => `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
      expect(errors).toEqual([]);
    });
  });
}


for (const mode of ['wire', 'hostInput']) {
  const path = mode === 'wire' ? process.env.ORBITAL_NATIVE_CONTRACT_WIRE_TYPES : process.env.ORBITAL_NATIVE_CONTRACT_HOST_TYPES;
  describe.skipIf(!path)(`canonical authored ${mode} type projection`, () => {
    it('checks real row, nullable predicate and batch contracts without widening fixed strings', () => {
      if (!path) throw new Error('canonical source-resolved backend-emitted row contract types path is required');
      const source = `import type { EntityRow, RowCompare, RowWriteBatch } from ${JSON.stringify(path)};
const row: EntityRow = { id: 'a', stamp: ${mode === 'hostInput' ? "new Date('2020-01-02')" : "'2020-01-02'"}, nested: { kept: true${mode === 'hostInput' ? ', omitted: undefined' : ''} }, values: ['x', null] };
const compare: RowCompare = { kind: 'compare', field: 'nullable', op: '==', value: null };
const batch: RowWriteBatch = { onFailure: 'atomic', ops: [{ kind: 'create', entityType: 'Task', data: row }] };
// @ts-expect-error fixed id stays string regardless of Date support
const dateId: EntityRow = { id: new Date('2020-01-02') };
// @ts-expect-error fixed id is optional but nonnullable
const nullId: EntityRow = { id: null };
// @ts-expect-error array members are required values
const undefinedArrayItem: EntityRow = { values: [undefined] };
// @ts-expect-error compare value is required even though nullable
const missingValue: RowCompare = { kind: 'compare', field: 'nullable', op: '==' };
// @ts-expect-error optional guard is nonnullable
const nullGuard: RowWriteBatch = { onFailure: 'atomic', ops: [{ kind: 'update', entityType: 'Task', id: 'a', data: {}, guard: null }] };
// @ts-expect-error failure mode stays a closed literal union
const invalidMode: RowWriteBatch = { onFailure: 'ignore', ops: [] };
${mode === 'wire' ? "// @ts-expect-error dates serialize before JSON wire admission\nconst rawDate: EntityRow = { stamp: new Date('2020-01-02') };\n// @ts-expect-error undefined object entries are omitted before JSON wire admission\nconst rawUndefinedMapValue: EntityRow = { nested: { omitted: undefined } };" : ''}
void [row, compare, batch, dateId, nullId, undefinedArrayItem, missingValue, nullGuard, invalidMode];`;
      const errors = checkProjection(path, source).map((diagnostic) => `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
      expect(errors).toEqual([]);
    });
  });
}
