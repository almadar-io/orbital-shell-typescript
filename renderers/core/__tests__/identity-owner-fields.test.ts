import { describe, expect, it } from 'vitest';

import {
    collectUserFieldLiterals,
    identityEntityName,
    ownerFieldsFromSchema,
    roleSatisfyingPolicy,
} from '../src/mock/identityOwners.js';
import type { OrbitalEntity } from '../src/types/entity.js';
import type { EntityField } from '../src/types/field.js';
import type { SExpr } from '../src/types/expression.js';
import type { Orbital } from '../src/types/orbital.js';
import type { OrbitalSchema } from '../src/types/schema.js';

/**
 * The JS half of the identity seeder. Its Rust twin is
 * `orbital-core/src/runtime/seed.rs::owner_fields_from_schema`; the two must
 * agree, or an app's ownership-scoped views work compiled and silently show
 * nothing interpreted — the exact silent-empty class the identity work exists
 * to kill.
 */

const ID_FIELD: EntityField = { name: 'id', type: 'string', required: true };

const relation = (name: string, target: string): EntityField => ({
    name,
    type: 'relation',
    relation: { entity: target, cardinality: 'one' },
});

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

const schemaOf = (orbitals: Orbital[]): OrbitalSchema => ({
    name: 'test-app',
    version: '1.0.0',
    orbitals,
});

const personOrbital = (fields: EntityField[] = [ID_FIELD]): Orbital =>
    orbital('PersonOrbital', identityEntity('Person', fields));

describe('ownerFieldsFromSchema', () => {
    it('returns nothing when no entity is tagged [identity]', () => {
        const schema = schemaOf([
            orbital('MessageOrbital', entity('Message', [relation('sender', 'Person')])),
        ]);

        expect(identityEntityName(schema)).toBeUndefined();
        // The no-op guarantee: every unmigrated app must seed exactly as before.
        expect(ownerFieldsFromSchema(schema)).toEqual([]);
    });

    it('derives owner columns ACROSS orbitals, not just the declaring one', () => {
        const schema = schemaOf([
            orbital('MessageOrbital', entity('Message', [relation('sender', 'Person')])),
            personOrbital(),
        ]);

        expect(identityEntityName(schema)).toBe('Person');
        expect(ownerFieldsFromSchema(schema)).toEqual(['Message.sender']);
    });

    it('ignores relations pointing at a NON-identity entity', () => {
        const schema = schemaOf([
            orbital(
                'MessageOrbital',
                entity('Message', [relation('sender', 'Person'), relation('channel', 'Channel')]),
            ),
            personOrbital(),
        ]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Message.sender']);
    });

    it('never guesses from a field NAME — an untyped id column is not an owner', () => {
        const schema = schemaOf([
            // Named exactly like an owner column, but still a bare string.
            orbital('MessageOrbital', entity('Message', [{ name: 'personId', type: 'string' }])),
            personOrbital(),
        ]);

        expect(ownerFieldsFromSchema(schema)).toEqual([]);
    });

    it('walks auxiliary entities, not only each orbital primary', () => {
        const schema = schemaOf([
            orbital('MessageOrbital', entity('Message', []), [
                entity('Draft', [relation('owner', 'Person')]),
            ]),
            personOrbital(),
        ]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Draft.owner']);
    });

    it('a same-collection sibling inherits a declared owner column by name; a different collection does not', () => {
        // Mirror of entityAccessTable's policy inheritance: a composed atom's
        // entity shares the collection (and therefore the @read scope) of the
        // organism's declaring entity, but structurally cannot declare the
        // identity relation itself.
        const declaring: OrbitalEntity = {
            ...entity('RenewalRiskSearch', [relation('assignedCsm', 'Person')]),
            collection: 'renewalrisks',
        };
        const atomView: OrbitalEntity = {
            ...entity('RenewalRisk', [{ name: 'assignedCsm', type: 'string' }]),
            collection: 'renewalrisks',
        };
        const otherCollection: OrbitalEntity = {
            ...entity('Invoice', [{ name: 'assignedCsm', type: 'string' }]),
            collection: 'invoices',
        };
        const schema = schemaOf([
            orbital('RiskOrbital', declaring, [atomView, otherCollection]),
            personOrbital(),
        ]);

        expect(ownerFieldsFromSchema(schema)).toEqual([
            'RenewalRiskSearch.assignedCsm',
            'RenewalRisk.assignedCsm',
        ]);
    });
});

/**
 * Self-identity: the `[identity]` entity's OWN `id` is the ownership key
 * when its access policy compares the row directly to the viewer.
 * `std-time-tracking`'s `Employee [identity]` declares
 * `@read (or (= @user.role "approver") (= (object/get @entity id) @user.id))`,
 * which the `.lolo` -> `.orb` lowering compiles to
 * `["=", ["object/get", "@entity", "id"], "@user.id"]` (verified against
 * `packages/almadar-behaviors/behaviors/registry/app/organisms/
 * std-time-tracking.orb`) — distinct from a relation column pointing AT
 * the identity entity.
 */
describe('self-identity ownership', () => {
    it('stamps Entity.id when @read compares (object/get @entity id) to @user.id', () => {
        const employee: OrbitalEntity = {
            ...identityEntity('Employee', [ID_FIELD]),
            read_policy: ['or', ['=', '@user.role', 'approver'], ['=', ['object/get', '@entity', 'id'], '@user.id']],
        };
        const schema = schemaOf([orbital('EmployeeOrbital', employee)]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Employee.id']);
    });

    it('matches either operand order (@user.id compared first)', () => {
        const employee: OrbitalEntity = {
            ...identityEntity('Employee', [ID_FIELD]),
            read_policy: ['=', '@user.id', ['object/get', '@entity', 'id']],
        };
        const schema = schemaOf([orbital('EmployeeOrbital', employee)]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Employee.id']);
    });

    it('also matches the dotted-path spelling (@entity.id), not only object/get', () => {
        const employee: OrbitalEntity = {
            ...identityEntity('Employee', [ID_FIELD]),
            read_policy: ['=', '@entity.id', '@user.id'],
        };
        const schema = schemaOf([orbital('EmployeeOrbital', employee)]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Employee.id']);
    });

    it('a relation column stays a relation owner column, not self-identity', () => {
        // `(object/get @entity managerId) == @user.id` is a relation to the
        // SAME identity roster, not the row's own id — the field-type scan
        // already finds it; self-identity must not ALSO claim `Employee.id`.
        const employee: OrbitalEntity = {
            ...identityEntity('Employee', [ID_FIELD, relation('managerId', 'Employee')]),
            read_policy: ['=', ['object/get', '@entity', 'managerId'], '@user.id'],
        };
        const schema = schemaOf([orbital('EmployeeOrbital', employee)]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Employee.managerId']);
    });

    it('@entity.id compared to a literal is not ownership', () => {
        const employee: OrbitalEntity = {
            ...identityEntity('Employee', [ID_FIELD]),
            read_policy: ['=', ['object/get', '@entity', 'id'], 'x'],
        };
        const schema = schemaOf([orbital('EmployeeOrbital', employee)]);

        expect(ownerFieldsFromSchema(schema)).toEqual([]);
    });
});

/**
 * Convergence with the codegen twin (`access_policies.rs::owner_fields`,
 * which shares `owner_columns_from_policy`): a policy naming a NON-relation
 * field is an owner column the type-only scan alone can never find — the
 * shape `ORB_S_OWNER_FIELD_NOT_IDENTITY_TYPED` flags as an authoring error,
 * but the seeder must still stamp it, matching what codegen already emits
 * as `ownerFields:`. Rust twin: `policy_derived_owner_tests` in
 * `orbital-core/src/runtime/seed.rs`.
 */
describe('policy-derived owner columns', () => {
    it('a non-relation field named by @read policy is an owner column', () => {
        const schema: OrbitalSchema = {
            name: 'App',
            version: '1.0.0',
            orbitals: [
                orbital('PersonOrbital', identityEntity('Person', [ID_FIELD])),
                {
                    name: 'NoteOrbital',
                    entity: {
                        ...entity('Note', [{ name: 'authorId', type: 'string' }]),
                        read_policy: ['==', ['object/get', '@entity', 'authorId'], '@user.id'],
                    },
                    traits: [],
                    pages: [],
                },
            ],
        };
        expect(ownerFieldsFromSchema(schema)).toEqual(['Note.authorId']);
    });

    it('@create is excluded from the policy-derived arm', () => {
        const schema: OrbitalSchema = {
            name: 'App',
            version: '1.0.0',
            orbitals: [
                orbital('PersonOrbital', identityEntity('Person', [ID_FIELD])),
                {
                    name: 'NoteOrbital',
                    entity: {
                        ...entity('Note', [{ name: 'authorId', type: 'string' }]),
                        create_policy: ['=', ['object/get', '@entity', 'authorId'], '@user.id'],
                    },
                    traits: [],
                    pages: [],
                },
            ],
        };
        expect(ownerFieldsFromSchema(schema)).toEqual([]);
    });
});

describe('intrinsic relation fields', () => {
    /**
     * `std-time-tracking`'s regression: a generic atom's self-relation
     * (`ModalRecord.seedRow : ModalRecord`, record-detail/modal edit-seed
     * plumbing — `@intrinsic` in `.lolo`) gets its relation target rewritten
     * onto whatever entity the composing trait binds, so `Employee [identity]`
     * ends up with an `Employee.seedRow : Employee` self-relation that is
     * type/target-indistinguishable from a real owner column. Before the fix,
     * `ownerFieldsFromSchema` classified it as an owner column, the cascade
     * probe stamped the viewer id into it, and the seeded row referenced
     * itself — tripping `Employee`'s own `onDelete: restrict` on delete.
     */
    it('excludes an intrinsic self-relation to the identity entity, even alongside a real owner column', () => {
        const intrinsicSelfRelation: EntityField = {
            ...relation('seedRow', 'Employee'),
            intrinsic: true,
        };
        const employee = identityEntity('Employee', [ID_FIELD, intrinsicSelfRelation]);
        const schema = schemaOf([
            orbital('EmployeeOrbital', employee),
            orbital('TimesheetOrbital', entity('Timesheet', [relation('employeeId', 'Employee')])),
        ]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Timesheet.employeeId']);
    });

    it('an intrinsic relation to a NON-identity entity is unaffected either way', () => {
        const schema = schemaOf([
            orbital(
                'MessageOrbital',
                entity('Message', [
                    relation('sender', 'Person'),
                    { ...relation('draftSeed', 'Message'), intrinsic: true },
                ]),
            ),
            personOrbital(),
        ]);

        expect(ownerFieldsFromSchema(schema)).toEqual(['Message.sender']);
    });
});

/**
 * An imported roster yields to the host's own — the JS twin of
 * `identity_entities` in `orbital-compiler/.../user_identity.rs`.
 *
 * Composing a behavior never imports the orbital that owns its roster, but a
 * trait bound to one of its siblings drags that roster in as an auxiliary copy,
 * tag and all. The composing app decides who `@user` is, so a PRIMARY roster
 * shadows the copy — while the copy's name keeps counting for owner columns,
 * or the imported behavior's rows go unscoped here and scoped when compiled.
 */
describe('an imported roster copy', () => {
    const hostAndImportedRoster = (hostIsRoster: boolean): OrbitalSchema =>
        schemaOf([
            orbital(
                'HostOrbital',
                hostIsRoster ? identityEntity('Staff', [ID_FIELD]) : entity('Staff', [ID_FIELD]),
            ),
            orbital(
                'TimesheetOrbital',
                entity('Timesheet', [ID_FIELD, relation('employeeId', 'Employee')]),
                [identityEntity('Employee', [ID_FIELD])],
            ),
        ]);

    it('yields to the host roster for @user', () => {
        expect(identityEntityName(hostAndImportedRoster(true))).toBe('Staff');
    });

    it('is still the viewer when the host declares no roster of its own', () => {
        expect(identityEntityName(hostAndImportedRoster(false))).toBe('Employee');
    });

    it('keeps its owner columns after being shadowed', () => {
        expect(ownerFieldsFromSchema(hostAndImportedRoster(true))).toContain('Timesheet.employeeId');
    });

    it('contributes no owner column when it was never a roster', () => {
        const schema = schemaOf([
            orbital('HostOrbital', identityEntity('Staff', [ID_FIELD])),
            orbital(
                'TimesheetOrbital',
                entity('Timesheet', [ID_FIELD, relation('employeeId', 'Employee')]),
                [entity('Employee', [ID_FIELD])],
            ),
        ]);
        expect(ownerFieldsFromSchema(schema)).not.toContain('Timesheet.employeeId');
    });
});

/**
 * B4-V5: the viewer role a runtime probe (`packages/almadar-verify`'s
 * `probeListenCascades`) synthesizes for a ROLE-ONLY persist policy — never
 * a heuristic, only literals actually compared against `@user.role` in the
 * declared policy, intersected with the identity entity's own declared
 * `role` vocabulary. Compiled-path twin: `check_comparison` in
 * `orbital-compiler/src/phases/validation/user_identity.rs`.
 */
const EMPLOYEE_APPROVER: OrbitalEntity = identityEntity('Employee', [
    ID_FIELD,
    { name: 'role', type: 'string', values: ['employee', 'approver'] },
]);

describe('collectUserFieldLiterals', () => {
    it('collects an equality literal keyed by the compared field', () => {
        const policy: SExpr = ['=', '@user.role', 'approver'];
        expect(collectUserFieldLiterals(policy)).toEqual(new Map([['role', new Set(['approver'])]]));
    });

    it('collects both arms of an `or`, regardless of the combinator wrapping them', () => {
        const policy: SExpr = ['or', ['=', '@user.role', 'employee'], ['=', '@user.role', 'approver']];
        expect(collectUserFieldLiterals(policy)).toEqual(
            new Map([['role', new Set(['employee', 'approver'])]]),
        );
    });

    it('reads the `array/includes` haystack as the sigil side, the second arg as the literal (forward shape)', () => {
        const policy: SExpr = ['array/includes', '@user.role', 'approver'];
        expect(collectUserFieldLiterals(policy)).toEqual(new Map([['role', new Set(['approver'])]]));
    });

    // B4-R4 (Rust `check_comparison`) found the Stage-B orbital-import role
    // rewrite (`roles { approver: [owner, project_manager] }`) emits the
    // REVERSED `array/includes` shape — a literal-array haystack first, the
    // `@user.<field>` needle second — live on Project Friday's imported
    // `Timesheet.@delete`. The sigil must be located BY CONTENT, not
    // position, on either side.
    it('locates the sigil on the SECOND arg when the first is a literal array (reversed shape)', () => {
        const policy: SExpr = ['array/includes', ['owner', 'project_manager'], '@user.role'];
        expect(collectUserFieldLiterals(policy)).toEqual(
            new Map([['role', new Set(['owner', 'project_manager'])]]),
        );
    });

    it('reversed shape with a single-element literal array still collects that one literal', () => {
        const policy: SExpr = ['array/includes', ['approver'], '@user.role'];
        expect(collectUserFieldLiterals(policy)).toEqual(new Map([['role', new Set(['approver'])]]));
    });

    it('ignores a comparison that does not read @user at all', () => {
        const policy: SExpr = ['=', (['object/get', '@entity', 'id'] as SExpr), '@entity.ownerId'];
        expect(collectUserFieldLiterals(policy).size).toBe(0);
    });

    // Rust twin `literal_haystack_members` (`user_identity.rs`): a haystack
    // is literal only when every element is a string literal. This nested
    // `object/get`/`array/nth` call (std-step-flow's per-step role guard)
    // is NOT a literal role list — collecting nothing avoids the false
    // positive that hit 8 corpus organisms ("object/get"/"allowedRoles"
    // reported as bogus role candidates).
    it('a dynamic object/get haystack collects nothing', () => {
        const policy: SExpr = [
            'array/includes',
            (['object/get', ['array/nth', '@config.steps', 0], 'allowedRoles'] as SExpr),
            '@user.role',
        ];
        expect(collectUserFieldLiterals(policy).size).toBe(0);
    });

    // A `["list", …]` array-construction wrap (the config-array-override
    // disambiguation both `.lolo` spellings `(a b)`/`[a, b]` lower through)
    // is a literal haystack whose TAIL is the member set — "list" itself
    // must never be collected as if it were a role literal.
    it('a `list`-call haystack collects only the tail, not "list" itself', () => {
        const policy: SExpr = ['array/includes', (['list', 'owner', 'project_manager'] as SExpr), '@user.role'];
        expect(collectUserFieldLiterals(policy)).toEqual(
            new Map([['role', new Set(['owner', 'project_manager'])]]),
        );
    });
});

describe('roleSatisfyingPolicy', () => {
    it('picks the declared role literal for a strict equality policy', () => {
        const policy: SExpr = ['=', '@user.role', 'approver'];
        expect(roleSatisfyingPolicy(policy, EMPLOYEE_APPROVER)).toBe('approver');
    });

    it('picks deterministically (declaration order) when the policy accepts more than one role', () => {
        const policy: SExpr = ['or', ['=', '@user.role', 'employee'], ['=', '@user.role', 'approver']];
        expect(roleSatisfyingPolicy(policy, EMPLOYEE_APPROVER)).toBe('employee');
    });

    it('returns undefined for an absent/null policy — nothing to satisfy', () => {
        expect(roleSatisfyingPolicy(undefined, EMPLOYEE_APPROVER)).toBeUndefined();
        expect(roleSatisfyingPolicy(null, EMPLOYEE_APPROVER)).toBeUndefined();
    });

    it('returns undefined when the policy accepts no roster role — a real finding, never forced', () => {
        const policy: SExpr = ['=', '@user.role', 'owner'];
        expect(roleSatisfyingPolicy(policy, EMPLOYEE_APPROVER)).toBeUndefined();
    });

    it('returns undefined when the identity entity declares no vocabulary for the field', () => {
        const noVocab = identityEntity('Employee', [ID_FIELD, { name: 'role', type: 'string' }]);
        const policy: SExpr = ['=', '@user.role', 'approver'];
        expect(roleSatisfyingPolicy(policy, noVocab)).toBeUndefined();
    });

    // Project Friday's imported `Timesheet.@delete` after `roles { approver:
    // [owner, project_manager] }` (B4-R4 / this fix): a reversed
    // `array/includes` — literal-array haystack first, `@user.role` needle
    // second — over a roster whose OWN vocabulary is `owner`/`project_manager`.
    it('picks a role from a reversed array/includes literal-array haystack', () => {
        const ownerPm = identityEntity('Employee', [
            ID_FIELD,
            { name: 'role', type: 'string', values: ['owner', 'project_manager'] },
        ]);
        const policy: SExpr = ['array/includes', ['owner', 'project_manager'], '@user.role'];
        expect(roleSatisfyingPolicy(policy, ownerPm)).toBe('owner');
    });
});
