/**
 * The current viewer's `@read` predicate per entity type, for the RowSetResolver (Speed Design 5.4: resolution
 * re-checks the CURRENT viewer's `@read`). Compiled by core's one `compileRowPredicate`, with `@user` folded
 * through the kernel's `resolveRowBinding`, as the store push-down does. A policy that
 * cannot be compiled hides every row (fail closed); an entity with no `@read` declares none.
 *
 * @packageDocumentation
 */
import { createLogger } from '@almadar/logger';
import { compileRowPredicate, kernelEvaluator, toWireValue, type Entity, type RowPredicate, type UserContext } from '@almadar/core';
import { requiredFieldNames } from '@almadar/db/pushdown';

const log = createLogger('almadar:ui:viewer-read-policy');

export function viewerReadPolicy(
  entities: readonly Entity[],
  user: UserContext | undefined,
): (entityType: string) => RowPredicate | undefined {
  const byName = new Map(entities.map((e) => [e.name, e]));
  return (entityType) => {
    const entity = byName.get(entityType);
    if (entity?.read_policy === undefined) return undefined;
    const compiled = compileRowPredicate(entity.read_policy, {
      resolve: (term) => kernelEvaluator().resolveRowBinding(term, user === undefined ? {} : { user: toWireValue(user) }),
      requiredFields: requiredFieldNames(entity.fields),
      role: 'policy',
    });
    if (compiled.kind === 'predicate') return compiled.predicate;
    log.warn('read policy not expressible; hiding every row', { entityType, kind: compiled.kind, detail: compiled.detail });
    return { kind: 'const', value: false };
  };
}
