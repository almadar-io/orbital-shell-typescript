/**
 * `answersToMutations` + `answerToMutations` reducer tests.
 *
 * One spec per `FactoryCallPlanMutationTemplate` variant + a
 * round-trip via `applyFactoryCallPlanMutation` for the happy path.
 * Plus structured-answer cases that exercise the widened
 * `DomainQuestionAnswer` union (object payloads, array-of-object
 * payloads).
 */

import { describe, expect, it } from 'vitest';
import {
  applyFactoryCallPlanMutation,
  type DomainQuestion,
  type DomainQuestionAnswers,
  type EntityField,
  type FactoryCallPlanState,
} from '../index';
import { answersToMutations, answerToMutations } from '../index';

function makeQuestion(
  template: DomainQuestion['mutationTemplate'],
): DomainQuestion {
  return {
    id: 'q1',
    question: 'q',
    reason: 'r',
    orbitalName: 'OrbitalX',
    inputType: 'text',
    mutationTemplate: template,
  };
}

const fieldName: EntityField = { name: 'name', type: 'string', required: true };
const fieldPrice: EntityField = {
  name: 'price',
  type: 'number',
  required: true,
};

describe('answerToMutations', () => {
  it('set-orbital-entity-name: produces one mutation', () => {
    const q = makeQuestion({
      kind: 'set-orbital-entity-name',
      orbitalName: 'OrbitalX',
    });
    expect(answerToMutations(q.mutationTemplate, 'Listing', q)).toEqual([
      {
        kind: 'set-orbital-entity-name',
        orbitalName: 'OrbitalX',
        name: 'Listing',
      },
    ]);
  });

  it('set-orbital-entity-fields: emits the fields list', () => {
    const q = makeQuestion({
      kind: 'set-orbital-entity-fields',
      orbitalName: 'OrbitalX',
    });
    expect(
      answerToMutations(q.mutationTemplate, [fieldName, fieldPrice], q),
    ).toEqual([
      {
        kind: 'set-orbital-entity-fields',
        orbitalName: 'OrbitalX',
        fields: [fieldName, fieldPrice],
      },
    ]);
  });

  it('set-orbital-entity-fields: empty array → no mutation', () => {
    const q = makeQuestion({
      kind: 'set-orbital-entity-fields',
      orbitalName: 'OrbitalX',
    });
    expect(answerToMutations(q.mutationTemplate, [], q)).toEqual([]);
  });

  it('set-orbital-page-path: emits the per-page path override', () => {
    const q = makeQuestion({
      kind: 'set-orbital-page-path',
      orbitalName: 'OrbitalX',
      pageName: 'ProductPage',
    });
    expect(answerToMutations(q.mutationTemplate, '/shop', q)).toEqual([
      {
        kind: 'set-orbital-page-path',
        orbitalName: 'OrbitalX',
        pageName: 'ProductPage',
        path: '/shop',
      },
    ]);
  });

  it('set-orbital-persistence: accepts a valid persistence', () => {
    const q = makeQuestion({
      kind: 'set-orbital-persistence',
      orbitalName: 'OrbitalX',
    });
    expect(answerToMutations(q.mutationTemplate, 'runtime', q)).toEqual([
      {
        kind: 'set-orbital-persistence',
        orbitalName: 'OrbitalX',
        persistence: 'runtime',
      },
    ]);
  });

  it('set-orbital-persistence: rejects invalid values', () => {
    const q = makeQuestion({
      kind: 'set-orbital-persistence',
      orbitalName: 'OrbitalX',
    });
    expect(answerToMutations(q.mutationTemplate, 'cloud', q)).toEqual([]);
  });

  it('set-orbital-collection: emits the collection override', () => {
    const q = makeQuestion({
      kind: 'set-orbital-collection',
      orbitalName: 'OrbitalX',
    });
    expect(answerToMutations(q.mutationTemplate, 'catalog', q)).toEqual([
      {
        kind: 'set-orbital-collection',
        orbitalName: 'OrbitalX',
        collection: 'catalog',
      },
    ]);
  });

  it('set-trait-override-config: threads a string answer through', () => {
    const q = makeQuestion({
      kind: 'set-trait-override-config',
      orbitalName: 'OrbitalX',
      traitName: 'Catalog',
      configKey: 'ownerField',
    });
    expect(answerToMutations(q.mutationTemplate, 'sellerId', q)).toEqual([
      {
        kind: 'set-trait-override-config',
        orbitalName: 'OrbitalX',
        traitName: 'Catalog',
        key: 'ownerField',
        value: 'sellerId',
      },
    ]);
  });

  it('set-trait-override-config: threads a number answer through', () => {
    const q = makeQuestion({
      kind: 'set-trait-override-config',
      orbitalName: 'OrbitalX',
      traitName: 'Retry',
      configKey: 'maxAttempts',
    });
    expect(answerToMutations(q.mutationTemplate, 5, q)).toEqual([
      {
        kind: 'set-trait-override-config',
        orbitalName: 'OrbitalX',
        traitName: 'Retry',
        key: 'maxAttempts',
        value: 5,
      },
    ]);
  });

  it('set-trait-override-config: threads a boolean answer through', () => {
    const q = makeQuestion({
      kind: 'set-trait-override-config',
      orbitalName: 'OrbitalX',
      traitName: 'Cache',
      configKey: 'enabled',
    });
    expect(answerToMutations(q.mutationTemplate, true, q)).toEqual([
      {
        kind: 'set-trait-override-config',
        orbitalName: 'OrbitalX',
        traitName: 'Cache',
        key: 'enabled',
        value: true,
      },
    ]);
  });

  it('set-trait-override-config: threads an array-of-objects answer through', () => {
    const q = makeQuestion({
      kind: 'set-trait-override-config',
      orbitalName: 'OrbitalX',
      traitName: 'Nav',
      configKey: 'navItems',
    });
    const navItems = [
      { href: '/home', label: 'Home' },
      { href: '/about', label: 'About' },
    ];
    expect(answerToMutations(q.mutationTemplate, navItems, q)).toEqual([
      {
        kind: 'set-trait-override-config',
        orbitalName: 'OrbitalX',
        traitName: 'Nav',
        key: 'navItems',
        value: navItems,
      },
    ]);
  });

  it('set-trait-override-config: threads a structured object answer through', () => {
    const q = makeQuestion({
      kind: 'set-trait-override-config',
      orbitalName: 'OrbitalX',
      traitName: 'Layout',
      configKey: 'size',
    });
    const size = { width: 800, height: 600 };
    expect(answerToMutations(q.mutationTemplate, size, q)).toEqual([
      {
        kind: 'set-trait-override-config',
        orbitalName: 'OrbitalX',
        traitName: 'Layout',
        key: 'size',
        value: size,
      },
    ]);
  });

  it('set-rule: emits a rule when the answer is yes', () => {
    const q = makeQuestion({
      kind: 'set-rule',
      capability: 'privacy',
      appliesTo: ['Product'],
    });
    const result = answerToMutations(q.mutationTemplate, 'yes', q);
    expect(result).toHaveLength(1);
    if (result[0].kind === 'set-rule') {
      expect(result[0].rule.capability).toBe('privacy');
      expect(result[0].rule.appliesTo).toEqual(['Product']);
    }
  });

  it('set-rule: emits nothing when the answer is anything other than yes', () => {
    const q = makeQuestion({
      kind: 'set-rule',
      capability: 'privacy',
      appliesTo: ['Product'],
    });
    expect(answerToMutations(q.mutationTemplate, 'skip', q)).toEqual([]);
    expect(answerToMutations(q.mutationTemplate, '', q)).toEqual([]);
  });
});

describe('answersToMutations', () => {
  it('walks the question array and applies all answered slots', () => {
    const questions: DomainQuestion[] = [
      {
        id: 'q1',
        question: 'rename?',
        reason: '',
        orbitalName: 'O',
        inputType: 'text',
        mutationTemplate: {
          kind: 'set-orbital-entity-name',
          orbitalName: 'O',
        },
      },
      {
        id: 'q2',
        question: 'fields?',
        reason: '',
        orbitalName: 'O',
        inputType: 'fieldList',
        mutationTemplate: {
          kind: 'set-orbital-entity-fields',
          orbitalName: 'O',
        },
      },
    ];
    const answers: DomainQuestionAnswers = {
      q1: 'Listing',
      q2: [fieldPrice],
    };
    expect(answersToMutations(answers, questions)).toEqual([
      { kind: 'set-orbital-entity-name', orbitalName: 'O', name: 'Listing' },
      {
        kind: 'set-orbital-entity-fields',
        orbitalName: 'O',
        fields: [fieldPrice],
      },
    ]);
  });

  it('skips questions whose answer is null or omitted', () => {
    const questions: DomainQuestion[] = [
      {
        id: 'q1',
        question: 'rename?',
        reason: '',
        orbitalName: 'O',
        inputType: 'text',
        mutationTemplate: {
          kind: 'set-orbital-entity-name',
          orbitalName: 'O',
        },
      },
      {
        id: 'q2',
        question: 'collection?',
        reason: '',
        orbitalName: 'O',
        inputType: 'text',
        mutationTemplate: {
          kind: 'set-orbital-collection',
          orbitalName: 'O',
        },
      },
    ];
    const answers: DomainQuestionAnswers = { q1: null };
    expect(answersToMutations(answers, questions)).toEqual([]);
  });

  it('round-trips: mutations → applyFactoryCallPlanMutation updates the plan', () => {
    let state: FactoryCallPlanState = {
      orbitals: [
        {
          orbitalName: 'OrbitalX',
          orbital: 'ProductOrbital',
          organism: 'std-ecommerce',
        },
      ],
    };
    const questions: DomainQuestion[] = [
      {
        id: 'q1',
        question: 'rename?',
        reason: '',
        orbitalName: 'OrbitalX',
        inputType: 'text',
        mutationTemplate: {
          kind: 'set-orbital-entity-name',
          orbitalName: 'OrbitalX',
        },
      },
      {
        id: 'q2',
        question: 'collection?',
        reason: '',
        orbitalName: 'OrbitalX',
        inputType: 'text',
        mutationTemplate: {
          kind: 'set-orbital-collection',
          orbitalName: 'OrbitalX',
        },
      },
    ];
    const answers: DomainQuestionAnswers = {
      q1: 'Listing',
      q2: 'catalog',
    };
    const mutations = answersToMutations(answers, questions);
    for (const m of mutations) state = applyFactoryCallPlanMutation(state, m);
    expect(state.orbitals[0].entityName).toBe('Listing');
    expect(state.orbitals[0].collection).toBe('catalog');
  });
});
