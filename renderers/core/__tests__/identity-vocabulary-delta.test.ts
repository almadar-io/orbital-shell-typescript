/**
 * An app has one identity; another organism's policies may compare `@user.<field>` to literals the
 * identity's closed vocabulary lacks (ORB_S_ROLE_LITERAL_NOT_MEMBER). The plan widens the identity
 * by an explicit field delta — this computes it.
 */
import { describe, expect, it } from 'vitest';
import { identityVocabularyDelta } from '../src/builders/compose-app.js';
import type { Entity, EntityField, OrbitalDefinition, SExpr } from '../src/types/index.js';

const identity = (role: EntityField): Entity => ({ name: 'OnlineUser', identity: true, fields: [{ name: 'id', type: 'string' }, role] });
const ROLE: EntityField = { name: 'role', type: 'enum', values: ['member', 'admin'] };

const guarded = (guard: SExpr, entityFields: EntityField[] = [{ name: 'id', type: 'string' }]): OrbitalDefinition => ({
  name: 'PieceOrbital',
  entity: { name: 'Piece', fields: entityFields },
  traits: [
    {
      name: 'PieceRules',
      scope: 'instance',
      linkedEntity: 'Piece',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [{ key: 'PUBLISH', name: 'PUBLISH' }],
        transitions: [{ from: 'idle', to: 'idle', event: 'PUBLISH', guard, effects: [] }],
      },
    },
  ],
  pages: [],
});

describe('identityVocabularyDelta', () => {
  it('a role another orbital compares @user.role to is added to the identity vocabulary', () => {
    const delta = identityVocabularyDelta(identity(ROLE), [guarded(['==', '@user.role', 'store-manager'])]);
    expect(delta.fields).toEqual([{ ...ROLE, values: ['member', 'admin', 'store-manager'] }]);
    expect(delta.added).toEqual([{ field: 'role', literals: ['store-manager'] }]);
  });

  it('control: a role the identity already declares adds nothing', () => {
    expect(identityVocabularyDelta(identity(ROLE), [guarded(['==', '@user.role', 'admin'])])).toEqual({ fields: [], added: [] });
  });

  it('control: a comparison on the orbital\'s own record field is not the identity\'s', () => {
    const own = guarded(['==', '@entity.role', 'curator'], [{ name: 'id', type: 'string' }, { name: 'role', type: 'string' }]);
    expect(identityVocabularyDelta(identity(ROLE), [own])).toEqual({ fields: [], added: [] });
  });

  it('a list-of-roles field is widened in its items, from an `array/includes` comparison', () => {
    const roles: EntityField = { name: 'roles', type: 'array', items: { name: 'roles', type: 'enum', values: ['member'] } };
    const delta = identityVocabularyDelta(identity(roles), [guarded(['array/includes', '@user.roles', 'buyer'])]);
    expect(delta.fields).toEqual([{ ...roles, items: { name: 'roles', type: 'enum', values: ['member', 'buyer'] } }]);
  });

  it('control: an open field (no vocabulary) is never widened', () => {
    const open: EntityField = { name: 'role', type: 'string' };
    expect(identityVocabularyDelta(identity(open), [guarded(['==', '@user.role', 'store-manager'])])).toEqual({ fields: [], added: [] });
  });

  it('literals from several orbitals are added once each, in order', () => {
    const delta = identityVocabularyDelta(identity(ROLE), [
      guarded(['or', ['==', '@user.role', 'store-manager'], ['==', '@user.role', 'operations-director']]),
      guarded(['==', '@user.role', 'store-manager']),
    ]);
    expect(delta.added).toEqual([{ field: 'role', literals: ['operations-director', 'store-manager'] }]);
  });
});
