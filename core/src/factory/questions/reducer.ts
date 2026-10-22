/**
 * `answersToMutations(answers, questions)` — turns a
 * `DomainQuestionAnswers` record into a typed
 * `FactoryCallPlanMutation[]`. Each question's `mutationTemplate`
 * matches one variant of the union; the answer fills in the value.
 * `null` (or omitted) answers produce no mutation.
 *
 * @packageDocumentation
 */

import type { EntityField } from '../../types/field.js';
import type { EntityPersistence } from '../../types/entity.js';
import type { TraitReference } from '../../types/trait.js';
import type { FactoryParamValue } from '../types.js';
import type { RuleOverlayEntry } from '../overlays.js';
import type { FactoryCallPlanMutation } from '../mutate.js';
import type {
  DomainQuestion,
  DomainQuestionAnswer,
  DomainQuestionAnswers,
  FactoryCallPlanMutationTemplate,
} from './types.js';

const PERSISTENCE_VALUES: ReadonlyArray<EntityPersistence> = [
  'persistent',
  'runtime',
];

export function answersToMutations(
  answers: DomainQuestionAnswers,
  questions: ReadonlyArray<DomainQuestion>,
): FactoryCallPlanMutation[] {
  const out: FactoryCallPlanMutation[] = [];
  for (const q of questions) {
    const answer = answers[q.id];
    if (answer === undefined || answer === null) continue;
    out.push(...answerToMutations(q.mutationTemplate, answer, q));
  }
  return out;
}

export function answerToMutations(
  template: FactoryCallPlanMutationTemplate,
  answer: DomainQuestionAnswer,
  _question: DomainQuestion,
): FactoryCallPlanMutation[] {
  switch (template.kind) {
    case 'set-orbital-entity-name': {
      if (typeof answer !== 'string' || answer.length === 0) return [];
      return [
        {
          kind: 'set-orbital-entity-name',
          orbitalName: template.orbitalName,
          name: answer,
        },
      ];
    }
    case 'set-orbital-entity-fields': {
      if (!isEntityFieldArray(answer)) return [];
      if (answer.length === 0) return [];
      return [
        {
          kind: 'set-orbital-entity-fields',
          orbitalName: template.orbitalName,
          fields: answer,
        },
      ];
    }
    case 'set-orbital-persistence': {
      if (!isPersistence(answer)) return [];
      return [
        {
          kind: 'set-orbital-persistence',
          orbitalName: template.orbitalName,
          persistence: answer,
        },
      ];
    }
    case 'set-orbital-collection': {
      if (typeof answer !== 'string' || answer.length === 0) return [];
      return [
        {
          kind: 'set-orbital-collection',
          orbitalName: template.orbitalName,
          collection: answer,
        },
      ];
    }
    case 'set-orbital-page-path': {
      if (typeof answer !== 'string' || answer.length === 0) return [];
      return [
        {
          kind: 'set-orbital-page-path',
          orbitalName: template.orbitalName,
          pageName: template.pageName,
          path: answer,
        },
      ];
    }
    case 'set-trait-override-config': {
      if (!isFactoryParamValue(answer)) return [];
      return [
        {
          kind: 'set-trait-override-config',
          orbitalName: template.orbitalName,
          traitName: template.traitName,
          key: template.configKey,
          value: answer,
        },
      ];
    }
    case 'add-extra-trait': {
      if (!isTraitReference(answer)) return [];
      return [
        {
          kind: 'add-extra-trait',
          orbitalName: template.orbitalName,
          trait: answer,
        },
      ];
    }
    case 'remove-extra-trait': {
      if (typeof answer !== 'string' || answer.length === 0) return [];
      return [
        {
          kind: 'remove-extra-trait',
          orbitalName: template.orbitalName,
          ref: answer,
        },
      ];
    }
    case 'set-rule': {
      if (typeof answer !== 'string') return [];
      if (answer !== 'yes') return [];
      const rule: RuleOverlayEntry = {
        id: `${template.capability}::${template.appliesTo.join(',')}`,
        capability: template.capability,
        description: `User accepted ${template.capability} for ${template.appliesTo.join(', ')}.`,
        appliesTo: template.appliesTo,
      };
      return [{ kind: 'set-rule', rule }];
    }
    case 'remove-rule': {
      return [{ kind: 'remove-rule', ruleId: template.ruleId }];
    }
  }
}

function isEntityFieldArray(
  a: DomainQuestionAnswer,
): a is ReadonlyArray<EntityField> {
  if (!Array.isArray(a)) return false;
  for (const x of a) {
    if (typeof x !== 'object' || x === null) return false;
    if (!('name' in x) || !('type' in x)) return false;
    if (typeof x.name !== 'string' || typeof x.type !== 'string') return false;
  }
  return true;
}

function isPersistence(a: DomainQuestionAnswer): a is EntityPersistence {
  return (
    typeof a === 'string' &&
    (PERSISTENCE_VALUES as ReadonlyArray<string>).includes(a)
  );
}

function isFactoryParamValue(a: DomainQuestionAnswer): a is FactoryParamValue {
  if (a === null) return false;
  const t = typeof a;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(a)) return true;
  if (t === 'object') return true;
  return false;
}

function isTraitReference(a: DomainQuestionAnswer): a is TraitReference {
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return false;
  if (!('ref' in a)) return false;
  return typeof a.ref === 'string';
}
