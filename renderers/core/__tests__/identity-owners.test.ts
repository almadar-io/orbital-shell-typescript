import { describe, expect, it } from 'vitest';

import { identityEntitiesOf, roleVocabularyOf } from '../src/mock/identityOwners.js';
import type { OrbitalEntity } from '../src/types/entity.js';
import type { EntityField } from '../src/types/field.js';
import type { Orbital } from '../src/types/orbital.js';

/**
 * `identityEntitiesOf` is the JS twin of `identity_entities` in
 * `orbital-compiler/src/phases/validation/user_identity.rs` (L94-102); the
 * ordering and shadowing rule must match exactly or the two paths disagree
 * about who `@user` is. `roleVocabularyOf` mirrors `vocabulary` (L125-134).
 */

const ID_FIELD: EntityField = { name: 'id', type: 'string', required: true };

const entity = (name: string, fields: EntityField[]): OrbitalEntity => ({ name, fields });

const identityEntity = (name: string, fields: EntityField[]): OrbitalEntity => ({
    name,
    identity: true,
    fields,
});

const orbital = (name: string, primary: OrbitalEntity, auxiliary?: OrbitalEntity[]): Orbital =>
    auxiliary
        ? { name, entity: primary, auxiliaryEntities: auxiliary, traits: [], pages: [] }
        : { name, entity: primary, traits: [], pages: [] };

describe('identityEntitiesOf', () => {
    it('returns nothing when no entity is tagged [identity]', () => {
        expect(identityEntitiesOf([orbital('MessageOrbital', entity('Message', [ID_FIELD]))])).toEqual([]);
    });

    it('a PRIMARY declared later still wins over an auxiliary declared earlier', () => {
        const orbitals: Orbital[] = [
            orbital('TimesheetOrbital', entity('Timesheet', [ID_FIELD]), [
                identityEntity('Employee', [ID_FIELD]),
            ]),
            orbital('HostOrbital', identityEntity('Staff', [ID_FIELD])),
        ];
        // Staff is a PRIMARY entity, so it wins outright — auxiliaries are
        // shadowed once any primary exists, regardless of which orbital
        // declared it first.
        expect(identityEntitiesOf(orbitals).map((e) => e.name)).toEqual(['Staff']);
    });

    it('with no primary roster, auxiliaries keep declaration order across orbitals', () => {
        const orbitals: Orbital[] = [
            orbital('TimesheetOrbital', entity('Timesheet', [ID_FIELD]), [
                identityEntity('Employee', [ID_FIELD]),
            ]),
            orbital('ApprovalOrbital', entity('ApprovalRequest', [ID_FIELD]), [
                identityEntity('Manager', [ID_FIELD]),
            ]),
        ];
        expect(identityEntitiesOf(orbitals).map((e) => e.name)).toEqual(['Employee', 'Manager']);
    });

    it('a PRIMARY roster shadows every imported (auxiliary) copy', () => {
        const orbitals: Orbital[] = [
            orbital('HostOrbital', identityEntity('Staff', [ID_FIELD])),
            orbital('TimesheetOrbital', entity('Timesheet', [ID_FIELD]), [
                identityEntity('Employee', [ID_FIELD]),
            ]),
        ];
        expect(identityEntitiesOf(orbitals).map((e) => e.name)).toEqual(['Staff']);
    });

    it('with no primary roster, imported copies still count', () => {
        const orbitals: Orbital[] = [
            orbital('HostOrbital', entity('Staff', [ID_FIELD])),
            orbital('TimesheetOrbital', entity('Timesheet', [ID_FIELD]), [
                identityEntity('Employee', [ID_FIELD]),
            ]),
        ];
        expect(identityEntitiesOf(orbitals).map((e) => e.name)).toEqual(['Employee']);
    });

    it('two primaries both survive (uniqueness is a separate validator\'s job)', () => {
        const orbitals: Orbital[] = [
            orbital('HostOrbital', identityEntity('Staff', [ID_FIELD])),
            orbital('OtherOrbital', identityEntity('Customer', [ID_FIELD])),
        ];
        expect(identityEntitiesOf(orbitals).map((e) => e.name)).toEqual(['Staff', 'Customer']);
    });
});

describe('roleVocabularyOf', () => {
    it('reads the scalar `values` hint on a string field', () => {
        const person = identityEntity('Person', [
            ID_FIELD,
            { name: 'role', type: 'string', values: ['owner', 'employee', 'approver'] },
        ]);
        expect(roleVocabularyOf(person)).toEqual(['owner', 'employee', 'approver']);
    });

    it('falls through to `items.values` for an array-typed field', () => {
        const person = identityEntity('Person', [
            ID_FIELD,
            {
                name: 'roles',
                type: 'array',
                items: { name: 'roles', type: 'string', values: ['owner', 'employee', 'approver'] },
            },
        ]);
        expect(roleVocabularyOf(person, 'roles')).toEqual(['owner', 'employee', 'approver']);
    });

    it('returns undefined when the field is absent', () => {
        const person = identityEntity('Person', [ID_FIELD]);
        expect(roleVocabularyOf(person)).toBeUndefined();
    });

    it('returns undefined when the field declares no vocabulary', () => {
        const person = identityEntity('Person', [ID_FIELD, { name: 'role', type: 'string' }]);
        expect(roleVocabularyOf(person)).toBeUndefined();
    });

    it('returns undefined for an empty `values` array (does not treat [] as a vocabulary)', () => {
        const person = identityEntity('Person', [ID_FIELD, { name: 'role', type: 'string', values: [] }]);
        expect(roleVocabularyOf(person)).toBeUndefined();
    });
});
