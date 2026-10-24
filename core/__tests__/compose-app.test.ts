/**
 * App composition from per-orbital files (`composeOrbitalSurface` / `composeAppFromFiles`): the
 * global-uniqueness backstops each orbital, authored or built in isolation, cannot see —
 * duplicate page routes and inline trait names (`dedupeComposedSurface`), more than one
 * `[identity]` entity (`dedupeComposedIdentity`, FIX-K/L/N) — plus the organism config union
 * (multi-organism `navItems` concatenated, deduped by href) and nav narrowed to owned pages.
 * Moved from rabit's composer (2026-10-04); its workdir-level tests stay in rabit.
 */
import { describe, it, expect } from 'vitest';
import { asTraitId, isEntityReferenceAny } from '../src/types/index.js';
import type { OrbitalDefinition, OrbitalPage, OrbitalSchema, PageTraitRef, Trait, TraitConfigValue, TraitReference } from '../src/types/index.js';
import { navItemHref } from '../src/embedded-trait-config.js';
import { unionOsGrants } from '../src/types/os-grants.js';
import { composeAppFromFiles, composeOrbitalSurface, dedupeComposedIdentity, dedupeComposedSurface, orbitalImportResolver, organismOrderResolver } from '../src/builders/compose-app.js';
import { composeBehaviors } from '../src/builders/compose-behaviors.js';


function inlineTrait(name: string, patternRef: string): TraitReference {
  return { ref: patternRef, name, linkedEntity: 'App' };
}

function landingPage(pageName: string, path: string, traitRefNames: string[]): OrbitalPage {
  return {
    name: pageName,
    path,
    traits: traitRefNames.map((n): PageTraitRef => ({ ref: n })),
  };
}

/** Two orbitals that both default their landing to "/" and both auto-number an inline Typography trait. */
function collidingPair(): OrbitalDefinition[] {
  const approvalQueue: OrbitalDefinition = {
    name: 'ApprovalQueue',
    entity: 'App.entity',
    traits: [
      inlineTrait('InlineSpinnerRender1', 'UiSpinner.traits.SpinnerRender'),
      inlineTrait('InlineTypographyRender2', 'UiTypography.traits.TypographyRender'),
    ],
    pages: [landingPage('ApprovalQueuePage', '/', ['InlineSpinnerRender1', 'InlineTypographyRender2'])],
  };
  const expenseDashboard: OrbitalDefinition = {
    name: 'ExpenseDashboard',
    entity: 'App.entity',
    traits: [
      // Same auto-numbered name as ApprovalQueue's second trait → global collision.
      {
        ...inlineTrait('InlineTypographyRender2', 'UiTypography.traits.TypographyRender'),
        // A self-navigate to the orbital's own "/" landing — must re-slug with the route.
        config: { onSelect: ['navigate', '/'] },
      },
    ],
    pages: [landingPage('ExpenseDashboardPage', '/', ['InlineTypographyRender2'])],
  };
  return [approvalQueue, expenseDashboard];
}

describe('dedupeComposedSurface — composer bug 1 (global page-route collisions)', () => {
  it('keeps the first orbital on "/" and re-slugs the second, so page paths are globally unique', () => {
    const orbitals = collidingPair();
    const { routes } = dedupeComposedSurface(orbitals);

    expect(routes).toEqual([
      { orbitalName: 'ExpenseDashboard', from: '/', to: '/expense-dashboard' },
    ]);

    const paths = orbitals.flatMap((o) =>
      (o.pages ?? []).flatMap((p) => (typeof p === 'object' && p !== null && 'path' in p ? [p.path] : [])),
    );
    expect(paths).toEqual(['/', '/expense-dashboard']);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('rewrites the orbital\'s own navigate target to the re-slugged route', () => {
    const orbitals = collidingPair();
    dedupeComposedSurface(orbitals);
    const dashTrait = (orbitals[1].traits ?? [])[0] as TraitReference;
    expect(dashTrait.config?.onSelect).toEqual(['navigate', '/expense-dashboard']);
  });
});

describe('dedupeComposedSurface — composer bug 2 (global inline-trait-name collisions)', () => {
  it('renames the second orbital\'s colliding inline trait with an orbital prefix', () => {
    const orbitals = collidingPair();
    const { traits } = dedupeComposedSurface(orbitals);

    expect(traits).toEqual([
      {
        orbitalName: 'ExpenseDashboard',
        from: 'InlineTypographyRender2',
        to: 'ExpenseDashboardInlineTypographyRender2',
      },
    ]);

    // Every inline trait NAME is now globally unique.
    const names = orbitals.flatMap((o) =>
      (o.traits ?? []).flatMap((t) => (typeof t === 'object' && t !== null && 'name' in t && t.name ? [t.name] : [])),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('rewrites the page trait reference in lockstep so the reference stays intact', () => {
    const orbitals = collidingPair();
    dedupeComposedSurface(orbitals);

    const dashPage = (orbitals[1].pages ?? [])[0] as OrbitalPage;
    const refNames = (dashPage.traits ?? []).map((t) =>
      typeof t === 'object' && t !== null && 'ref' in t ? t.ref : t,
    );
    // The page now references the renamed trait, not the old colliding name.
    expect(refNames).toEqual(['ExpenseDashboardInlineTypographyRender2']);

    // The definition and its reference agree — no dangling reference.
    const dashTrait = (orbitals[1].traits ?? [])[0] as TraitReference;
    expect(dashTrait.name).toBe('ExpenseDashboardInlineTypographyRender2');
  });

  it('leaves the inline trait\'s pattern ref (Alias.traits.X) untouched', () => {
    const orbitals = collidingPair();
    dedupeComposedSurface(orbitals);
    const dashTrait = (orbitals[1].traits ?? [])[0] as TraitReference;
    expect(dashTrait.ref).toBe('UiTypography.traits.TypographyRender');
  });
});

describe('dedupeComposedSurface — V4 id capture on trait renames', () => {
  it('carries the renamed declaration\'s id so the caller can sync the merged ledger', () => {
    const orbitals = collidingPair();
    const second = (orbitals[1].traits ?? [])[0] as TraitReference;
    second.id = asTraitId('trt_TESTID2');

    const { traits } = dedupeComposedSurface(orbitals);
    expect(traits).toEqual([
      {
        orbitalName: 'ExpenseDashboard',
        from: 'InlineTypographyRender2',
        to: 'ExpenseDashboardInlineTypographyRender2',
        id: 'trt_TESTID2',
      },
    ]);
  });
});


describe('dedupeComposedSurface — single-orbital / clean plans are byte-stable no-ops', () => {
  it('single orbital → no renames, identical output', () => {
    const orbitals: OrbitalDefinition[] = [
      {
        name: 'Solo',
        entity: 'App.entity',
        traits: [inlineTrait('InlineTypographyRender2', 'UiTypography.traits.TypographyRender')],
        pages: [landingPage('SoloPage', '/', ['InlineTypographyRender2'])],
      },
    ];
    const before = JSON.stringify(orbitals);
    const { routes, traits } = dedupeComposedSurface(orbitals);
    expect(routes).toEqual([]);
    expect(traits).toEqual([]);
    expect(JSON.stringify(orbitals)).toBe(before);
  });

  it('two orbitals with already-distinct routes and trait names → no renames, byte-stable', () => {
    const orbitals: OrbitalDefinition[] = [
      {
        name: 'TicketSubmissionForm',
        entity: 'App.entity',
        traits: [inlineTrait('InlineFormRender1', 'UiForm.traits.FormRender')],
        pages: [landingPage('FormPage', '/', ['InlineFormRender1'])],
      },
      {
        name: 'TriageQueue',
        entity: 'App.entity',
        traits: [inlineTrait('InlineDataGridRender1', 'UiDataGrid.traits.DataGridRender')],
        pages: [landingPage('QueuePage', '/triage', ['InlineDataGridRender1'])],
      },
    ];
    const before = JSON.stringify(orbitals);
    const { routes, traits } = dedupeComposedSurface(orbitals);
    expect(routes).toEqual([]);
    expect(traits).toEqual([]);
    expect(JSON.stringify(orbitals)).toBe(before);
  });
});

describe('dedupeComposedIdentity — composer backstop (global [identity] collisions)', () => {
  function identityPair(): OrbitalDefinition[] {
    return [
      {
        name: 'OnlineUserOrbital',
        entity: { name: 'OnlineUser', persistence: 'persistent', identity: true, fields: [] },
        traits: [],
        pages: [],
      },
      {
        name: 'TeamMemberOrbital',
        entity: { name: 'TeamMember', persistence: 'persistent', identity: true, fields: [] },
        traits: [],
        pages: [],
      },
    ];
  }

  it('keeps the first roster orbital\'s identity and demotes the second, composed surface only', () => {
    const orbitals = identityPair();
    const { demotions } = dedupeComposedIdentity(orbitals);

    expect(demotions).toEqual([{ orbitalName: 'TeamMemberOrbital', entityName: 'TeamMember' }]);
    const first = orbitals[0]!.entity;
    const second = orbitals[1]!.entity;
    expect(typeof first === 'object' && !isEntityReferenceAny(first) && first.identity).toBe(true);
    expect(typeof second === 'object' && !isEntityReferenceAny(second) && 'identity' in second).toBe(false);
  });

  it('does not mutate the demoted orbital\'s original entity object (source untouched)', () => {
    const orbitals = identityPair();
    const originalSecond = orbitals[1]!.entity;
    dedupeComposedIdentity(orbitals);
    expect(typeof originalSecond === 'object' && !isEntityReferenceAny(originalSecond) && originalSecond.identity).toBe(true);
  });

  it('single identity → no demotions, byte-stable', () => {
    const orbitals: OrbitalDefinition[] = [
      {
        name: 'OnlineUserOrbital',
        entity: { name: 'OnlineUser', persistence: 'persistent', identity: true, fields: [] },
        traits: [],
        pages: [],
      },
      {
        name: 'TaskOrbital',
        entity: { name: 'Task', persistence: 'persistent', fields: [] },
        traits: [],
        pages: [],
      },
    ];
    const before = JSON.stringify(orbitals);
    expect(dedupeComposedIdentity(orbitals)).toEqual({ demotions: [], roleUnions: [], expectsRewrites: [], relationsRetargeted: [] });
    expect(JSON.stringify(orbitals)).toBe(before);
  });

  it('string-ref entities are skipped (no inline identity to demote)', () => {
    const orbitals: OrbitalDefinition[] = [
      {
        name: 'OnlineUserOrbital',
        entity: { name: 'OnlineUser', persistence: 'persistent', identity: true, fields: [] },
        traits: [],
        pages: [],
      },
      { name: 'RefOrbital', entity: 'App.entity', traits: [], pages: [] },
    ];
    expect(dedupeComposedIdentity(orbitals).demotions).toEqual([]);
  });
});
describe('dedupeComposedIdentity — FIX-K (role-vocabulary union on identity demotion)', () => {
  function disjointRoleRoster(): OrbitalDefinition[] {
    return [
      {
        name: 'OnlineUserOrbital',
        entity: {
          name: 'OnlineUser',
          persistence: 'persistent',
          identity: true,
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'role', type: 'enum', values: ['member', 'moderator', 'admin'] },
          ],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'TeamMemberOrbital',
        entity: {
          name: 'TeamMember',
          persistence: 'persistent',
          identity: true,
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'role', type: 'enum', values: ['manager', 'product-owner', 'engineering-manager'] },
          ],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'ProjectOrbital',
        entity: {
          name: 'Project',
          persistence: 'persistent',
          // Baked by the loser's organism: post-dedupe `@user` resolves to
          // OnlineUser, so these literals must become OnlineUser.role members.
          update_policy: ['or',
            ['==', '@user.role', 'manager'],
            ['eq', '@user.role', 'product-owner'],
            ['array/includes', ['object/get', '@user', 'role'], 'engineering-manager'],
          ],
          fields: [{ name: 'id', type: 'string', required: true }],
        },
        traits: [],
        pages: [],
      },
    ];
  }

  it('unions the demoted identity\'s referenced role literals into the winner\'s enum, policies intact', () => {
    const orbitals = disjointRoleRoster();
    const { demotions, roleUnions } = dedupeComposedIdentity(orbitals);

    expect(demotions).toEqual([{ orbitalName: 'TeamMemberOrbital', entityName: 'TeamMember' }]);
    expect(roleUnions).toEqual([
      {
        orbitalName: 'OnlineUserOrbital',
        entityName: 'OnlineUser',
        field: 'role',
        addedLiterals: ['engineering-manager', 'manager', 'product-owner'],
      },
    ]);

    const winner = orbitals[0]!.entity;
    if (winner === undefined || isEntityReferenceAny(winner)) throw new Error('winner entity must stay inline');
    const role = winner.fields.find((f) => f.name === 'role');
    expect(role && 'values' in role ? role.values : undefined).toEqual([
      'member',
      'moderator',
      'admin',
      'engineering-manager',
      'manager',
      'product-owner',
    ]);

    // The loser's sibling keeps its baked policy byte-for-byte — only the
    // winner's vocabulary grew.
    const project = orbitals[2]!.entity;
    if (project === undefined || isEntityReferenceAny(project)) throw new Error('project entity must stay inline');
    expect(project.update_policy).toEqual(['or',
      ['==', '@user.role', 'manager'],
      ['eq', '@user.role', 'product-owner'],
      ['array/includes', ['object/get', '@user', 'role'], 'engineering-manager'],
    ]);
  });

  it('the demoted identity\'s declared vocabulary joins even where only its own entity name compares it (ruling 2026-10-04)', () => {
    const orbitals = disjointRoleRoster();
    const project = orbitals[2]!.entity;
    if (project === undefined || isEntityReferenceAny(project)) throw new Error('inline entity expected');
    project.update_policy = ['==', '@TeamMember.role', 'manager'];

    const { roleUnions } = dedupeComposedIdentity(orbitals);
    expect(roleUnions).toEqual([{ orbitalName: 'OnlineUserOrbital', entityName: 'OnlineUser', field: 'role', addedLiterals: ['engineering-manager', 'manager', 'product-owner'] }]);
    const winner = orbitals[0]!.entity;
    if (winner === undefined || isEntityReferenceAny(winner)) throw new Error('winner entity must stay inline');
    const role = winner.fields.find((f) => f.name === 'role');
    expect(role && 'values' in role ? role.values : undefined).toEqual(['member', 'moderator', 'admin', 'engineering-manager', 'manager', 'product-owner']);
  });

  it('open-vocabulary winner field (no declared values) → nothing to union, no error', () => {
    const orbitals = disjointRoleRoster();
    const winner = orbitals[0]!.entity;
    if (winner === undefined || isEntityReferenceAny(winner)) throw new Error('inline entity expected');
    winner.fields = winner.fields.map((f) => (f.name === 'role' ? { name: 'role', type: 'string' } : f));

    const { roleUnions } = dedupeComposedIdentity(orbitals);
    expect(roleUnions).toEqual([]);
  });

  it('shape mismatch — referenced literal names a field the winner does not declare → deterministic error, never silent', () => {
    const mismatchRoster = (): OrbitalDefinition[] => {
      const orbitals = disjointRoleRoster();
      const loser = orbitals[1]!.entity;
      if (loser === undefined || isEntityReferenceAny(loser)) throw new Error('inline entity expected');
      loser.fields = [...loser.fields, { name: 'clearance', type: 'enum', values: ['top-secret'] }];
      const project = orbitals[2]!.entity;
      if (project === undefined || isEntityReferenceAny(project)) throw new Error('inline entity expected');
      project.update_policy = ['==', '@user.clearance', 'top-secret'];
      return orbitals;
    };

    expect(() => dedupeComposedIdentity(mismatchRoster())).toThrowError(/identity dedupe shape mismatch/);
    expect(() => dedupeComposedIdentity(mismatchRoster())).toThrowError(/@user\.clearance[\s\S]*"top-secret"[\s\S]*OnlineUser/);
  });
});

describe('dedupeComposedIdentity — FIX-L (expects rewrite on identity demotion)', () => {
  function expectsRoster(): OrbitalDefinition[] {
    return [
      {
        name: 'AuthorOrbital',
        entity: {
          name: 'Author',
          persistence: 'persistent',
          identity: true,
          fields: [{ name: 'id', type: 'string', required: true }],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'TeamMemberOrbital',
        entity: {
          name: 'TeamMember',
          persistence: 'persistent',
          identity: true,
          fields: [{ name: 'id', type: 'string', required: true }],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'ContactOrbital',
        entity: {
          name: 'Contact',
          persistence: 'persistent',
          fields: [{ name: 'id', type: 'string', required: true }],
        },
        expects: [
          {
            kind: 'identity',
            name: 'TeamMember',
            shape: [{ name: 'role', type: 'enum', values: ['manager'] }],
          },
        ],
        traits: [],
        pages: [],
      },
    ];
  }

  it('preserves full viewer requirements on the surviving identity alongside the demoted record', () => {
    const orbitals = expectsRoster();
    const shape = [{ name: 'role', type: 'enum' as const, values: ['manager'], required: true }, { name: 'email', type: 'email' as const, required: true }];
    orbitals[2]!.expects = [{ kind: 'identity', name: 'TeamMember', shape }];
    dedupeComposedIdentity(orbitals);
    expect(orbitals[2]!.expects).toContainEqual({ kind: 'identity', name: 'Author', shape });
    expect(orbitals[2]!.expects).toContainEqual({ kind: 'entity', name: 'TeamMember', shape });
  });

  it('unions required viewer vocabulary into one existing winning identity without mutating requirements', () => {
    const orbitals = expectsRoster();
    const expects = [{ kind: 'identity' as const, name: 'Author', shape: [{ name: 'role', type: 'string' as const, values: ['member'], description: 'existing' }] }, { kind: 'identity' as const, name: 'TeamMember', shape: [{ name: 'role', type: 'enum' as const, values: ['manager'], required: true }] }];
    orbitals[2]!.expects = expects;
    const before = structuredClone(expects);
    dedupeComposedIdentity(orbitals);
    const viewer = orbitals[2]!.expects?.filter(e => e.kind === 'identity');
    expect(viewer).toHaveLength(1);
    expect(viewer?.[0]).toMatchObject({ name: 'Author', shape: [{ name: 'role', values: ['member', 'manager'], required: true }] });
    expect(expects).toEqual(before);
  });

  it('combines multiple demoted viewer contracts once while retaining each record requirement', () => {
    const orbitals = expectsRoster();
    orbitals.push({ name: 'GuestOrbital', entity: { name: 'Guest', identity: true, fields: [{ name: 'id', type: 'string' }] }, traits: [], pages: [] });
    orbitals[2]!.expects?.push({ kind: 'identity', name: 'Guest', shape: [{ name: 'email', type: 'email', required: true }] });
    dedupeComposedIdentity(orbitals);
    expect(orbitals[2]!.expects?.filter(e => e.kind === 'identity')).toEqual([{ kind: 'identity', name: 'Author', shape: [{ name: 'role', type: 'enum', values: ['manager'] }, { name: 'email', type: 'email', required: true }] }]);
    expect(orbitals[2]!.expects?.filter(e => e.kind === 'entity').map(e => e.name)).toEqual(['TeamMember', 'Guest']);
  });

  it('rewrites a dependent\'s `expects identity <demoted>` → `expects entity <demoted>`, shape preserved', () => {
    const orbitals = expectsRoster();
    const { demotions, expectsRewrites } = dedupeComposedIdentity(orbitals);

    expect(demotions).toEqual([{ orbitalName: 'TeamMemberOrbital', entityName: 'TeamMember' }]);
    expect(expectsRewrites).toEqual([{ orbitalName: 'ContactOrbital', entityName: 'TeamMember' }]);
    expect(orbitals[2]!.expects?.filter(e => e.kind === 'entity')).toEqual([
      { kind: 'entity', name: 'TeamMember', shape: [{ name: 'role', type: 'enum', values: ['manager'] }] },
    ]);
  });

  it('leaves `expects identity` naming the WINNER (or unnamed) untouched', () => {
    const orbitals = expectsRoster();
    orbitals[2]!.expects = [
      { kind: 'identity', name: 'Author' },
      { kind: 'identity' },
    ];

    const { expectsRewrites } = dedupeComposedIdentity(orbitals);
    expect(expectsRewrites).toEqual([]);
    expect(orbitals[2]!.expects).toEqual([
      { kind: 'identity', name: 'Author' },
      { kind: 'identity' },
    ]);
  });

  it('leaves `expects entity <demoted>` untouched (already the post-demotion shape)', () => {
    const orbitals = expectsRoster();
    orbitals[2]!.expects = [{ kind: 'entity', name: 'TeamMember' }];

    const { expectsRewrites } = dedupeComposedIdentity(orbitals);
    expect(expectsRewrites).toEqual([]);
    expect(orbitals[2]!.expects).toEqual([{ kind: 'entity', name: 'TeamMember' }]);
  });
});
describe('dedupeComposedSurface — FIX-M (@trait.<old> tokens rewritten on inline-trait rename)', () => {
  /**
   * The monday-style-project-suite shape: two orbitals auto-number the same
   * inline trait, and the second orbital's layout trait carries a nested
   * `children` default of `@trait.<name>` tokens pointing at it.
   */
  function tokenPair(): OrbitalDefinition[] {
    return [
      {
        name: 'BacklogOrbital',
        entity: 'App.entity',
        traits: [inlineTrait('InlineIconRender6', 'UiIcon.traits.IconRender')],
        pages: [landingPage('BacklogPage', '/backlog', ['InlineIconRender6'])],
      },
      {
        name: 'SprintOrbital',
        entity: 'App.entity',
        traits: [
          inlineTrait('InlineIconRender6', 'UiIcon.traits.IconRender'),
          {
            ...inlineTrait('InlineHstackRender8', 'UiHstack.traits.HstackRender'),
            config: {
              children: {
                type: 'array',
                default: ['@trait.InlineIconRender6', '@trait.InlineIconRender60', '@trait.InlineTypographyRender2'],
              },
            },
          },
        ],
        pages: [landingPage('SprintPage', '/sprint', ['InlineHstackRender8'])],
      },
    ];
  }

  it('rewrites `@trait.<old>` tokens in nested config values when the declaration is renamed', () => {
    const orbitals = tokenPair();
    const { traits } = dedupeComposedSurface(orbitals);

    expect(traits).toEqual([
      { orbitalName: 'SprintOrbital', from: 'InlineIconRender6', to: 'SprintInlineIconRender6' },
    ]);
    const hstack = (orbitals[1]!.traits ?? [])[1] as TraitReference;
    const children = hstack.config?.['children'];
    expect(
      typeof children === 'object' && children !== null && 'default' in children ? children.default : undefined,
    ).toEqual(['@trait.SprintInlineIconRender6', '@trait.InlineIconRender60', '@trait.InlineTypographyRender2']);
  });

  it('boundary-checks: a longer name sharing the prefix is not clobbered', () => {
    const orbitals = tokenPair();
    dedupeComposedSurface(orbitals);
    const hstack = (orbitals[1]!.traits ?? [])[1] as TraitReference;
    const children = hstack.config?.['children'];
    const tokens = typeof children === 'object' && children !== null && 'default' in children ? children.default : [];
    // `@trait.InlineIconRender60` must survive the `InlineIconRender6` rename.
    expect(tokens).toContain('@trait.InlineIconRender60');
  });

  it('does not mutate the caller\'s original orbital definitions (composed surface only)', () => {
    const orbitals = tokenPair();
    const original = JSON.stringify(orbitals[1]);
    dedupeComposedSurface(orbitals);
    // orbitals[1] was REPLACED; the object the caller passed in is untouched.
    expect(JSON.stringify(tokenPair()[1])).toBe(original);
  });

  it('rewrites `@trait.<old>` tokens inside state-machine effect trees too', () => {
    const orbitals = tokenPair();
    const sprint = orbitals[1]!;
    const inlineButton: Trait = {
      name: 'InlineButtonRender9',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [{ key: 'SELECT', name: 'Select' }],
        transitions: [
          { from: 'idle', to: 'idle', event: 'SELECT', effects: [['emit', '@trait.InlineIconRender6']] },
        ],
      },
    };
    (sprint.traits ??= []).push(inlineButton);
    dedupeComposedSurface(orbitals);
    const button = (orbitals[1]!.traits ?? [])[2];
    const effects =
      typeof button === 'object' && 'stateMachine' in button
        ? button.stateMachine?.transitions[0]?.effects
        : undefined;
    expect(effects).toEqual([['emit', '@trait.SprintInlineIconRender6']]);
  });
});

// G-CORE-018 — an orbital imported from another organism expects THAT organism's identity, which
// the composed app may hold only as a plain record (time tracking's `Employee` next to HR's
// non-identity `Employee`) or not at all (the executive dashboard's `ExecutivePerson`). After
// compose `@user` is the one winning identity either way.
describe('dedupeComposedIdentity — an expected identity no orbital provides as identity', () => {
  function roster(): OrbitalDefinition[] {
    return [
      {
        name: 'TeamMemberOrbital',
        entity: {
          name: 'TeamMember',
          persistence: 'persistent',
          identity: true,
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'role', type: 'enum', values: ['manager'] },
          ],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'EmployeeOrbital',
        entity: { name: 'Employee', persistence: 'persistent', fields: [{ name: 'id', type: 'string', required: true }] },
        traits: [],
        pages: [],
      },
      {
        name: 'TimesheetOrbital',
        entity: { name: 'Timesheet', persistence: 'persistent', fields: [{ name: 'id', type: 'string', required: true }] },
        expects: [{ kind: 'identity', name: 'Employee', shape: [{ name: 'role', type: 'enum', values: ['employee', 'approver'] }] }],
        traits: [],
        pages: [],
      },
      {
        name: 'ExecutiveOverviewOrbital',
        entity: { name: 'ExecInvoice', persistence: 'persistent', fields: [{ name: 'id', type: 'string', required: true }] },
        expects: [{ kind: 'identity', name: 'ExecutivePerson', shape: [{ name: 'role', type: 'enum', values: ['executive', 'department-head'] }] }],
        traits: [],
        pages: [],
      },
    ];
  }

  it('an expected identity held only as a plain record becomes `expects entity`, with no demotion needed', () => {
    const orbitals = roster();
    const { demotions, expectsRewrites } = dedupeComposedIdentity(orbitals);
    expect(demotions).toEqual([]);
    expect(expectsRewrites).toEqual([{ orbitalName: 'TimesheetOrbital', entityName: 'Employee' }]);
    expect(orbitals[2]!.expects?.filter(e => e.kind === 'entity')).toEqual([
      { kind: 'entity', name: 'Employee', shape: [{ name: 'role', type: 'enum', values: ['employee', 'approver'] }] },
    ]);
  });

  it("a rewritten expectation carries each shape field as the providing record declares it", () => {
    const orbitals = roster();
    orbitals[1] = {
      ...orbitals[1]!,
      entity: { name: 'Employee', persistence: 'persistent', fields: [{ name: 'id', type: 'string', required: true }, { name: 'email', type: 'email' }] },
    };
    orbitals[2] = { ...orbitals[2]!, expects: [{ kind: 'identity', name: 'Employee', shape: [{ name: 'email', type: 'email', required: true }, { name: 'badge', type: 'string', required: true }] }] };
    dedupeComposedIdentity(orbitals);
    expect(orbitals[2]!.expects?.filter(e => e.kind === 'entity')).toEqual([
      { kind: 'entity', name: 'Employee', shape: [{ name: 'email', type: 'email' }, { name: 'badge', type: 'string', required: true }] },
    ]);
  });

  it("each such expectation's role vocabulary joins the winning identity's", () => {
    const orbitals = roster();
    const { roleUnions } = dedupeComposedIdentity(orbitals);
    expect(roleUnions).toEqual([
      { orbitalName: 'TeamMemberOrbital', entityName: 'TeamMember', field: 'role', addedLiterals: ['approver', 'department-head', 'employee', 'executive'] },
    ]);
  });

  it('an expected identity no orbital provides at all stays an identity expectation', () => {
    const orbitals = roster();
    dedupeComposedIdentity(orbitals);
    expect(orbitals[3]!.expects).toEqual([
      { kind: 'identity', name: 'ExecutivePerson', shape: [{ name: 'role', type: 'enum', values: ['executive', 'department-head'] }] },
    ]);
  });

  it('control: expectations naming the winner change nothing', () => {
    const orbitals = roster().slice(0, 2);
    orbitals.push({ ...roster()[2]!, expects: [{ kind: 'identity', name: 'TeamMember', shape: [{ name: 'role', type: 'enum', values: ['manager'] }] }] });
    expect(dedupeComposedIdentity(orbitals)).toEqual({ demotions: [], roleUnions: [], expectsRewrites: [], relationsRetargeted: [] });
  });

  it("an owner field related to such an expected identity is retargeted to the winner; a data relation stays", () => {
    const orbitals = roster();
    orbitals[2] = {
      ...orbitals[2]!,
      entity: {
        name: 'Timesheet',
        persistence: 'persistent',
        update_policy: ['==', '@entity.employeeId', '@user.id'],
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'employeeId', type: 'relation', relation: { entity: 'Employee', cardinality: 'one' } },
          { name: 'approver', type: 'relation', relation: { entity: 'Employee', cardinality: 'one' } },
        ],
      },
    };
    const { relationsRetargeted } = dedupeComposedIdentity(orbitals);
    expect(relationsRetargeted).toEqual([
      { orbitalName: 'TimesheetOrbital', entityName: 'Timesheet', field: 'employeeId', fromEntity: 'Employee', toEntity: 'TeamMember' },
    ]);
  });

  it('edge: without any identity in the app nothing is rewritten', () => {
    const orbitals = roster().slice(1);
    expect(dedupeComposedIdentity(orbitals).expectsRewrites).toEqual([]);
    expect(orbitals[1]!.expects?.[0]?.kind).toBe('identity');
  });
});

describe('dedupeComposedIdentity — FIX-N (owner-relation retarget on identity demotion)', () => {
  /**
   * The add-cross-organism-chat shape: Task.assignee / Task.reporter are
   * relations to the DEMOTED identity (TeamMember) but are owner-compared to
   * `@user.id` in the baked read policy (both binding forms, `or`-nested) and
   * stamped by a persist create effect. Sprint.members is a plain data
   * relation to TeamMember — never owner-compared — and must stay put.
   */
  function ownerRoster(): OrbitalDefinition[] {
    return [
      {
        name: 'OnlineUserOrbital',
        entity: {
          name: 'OnlineUser',
          persistence: 'persistent',
          identity: true,
          fields: [{ name: 'id', type: 'string', required: true }],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'TeamMemberOrbital',
        entity: {
          name: 'TeamMember',
          persistence: 'persistent',
          identity: true,
          fields: [{ name: 'id', type: 'string', required: true }],
        },
        traits: [],
        pages: [],
      },
      {
        name: 'TaskOrbital',
        entity: {
          name: 'Task',
          persistence: 'persistent',
          read_policy: ['or',
            ['=', ['object/get', '@entity', 'assignee'], '@user.id'],
            ['==', '@entity.assignee', '@user.id'],
          ],
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'assignee', type: 'relation', relation: { entity: 'TeamMember', cardinality: 'one' } },
            { name: 'reporter', type: 'relation', relation: { entity: 'TeamMember', cardinality: 'one' } },
          ],
        },
        traits: [
          {
            name: 'TaskEditor',
            stateMachine: {
              states: [{ name: 'editing', isInitial: true }],
              events: [{ key: 'SAVE', name: 'Save' }],
              transitions: [
                {
                  from: 'editing',
                  to: 'editing',
                  event: 'SAVE',
                  effects: [['persist', 'create', 'Task', { title: 'x', reporter: '@user.id' }]],
                },
              ],
            },
          },
        ],
        pages: [],
      },
      {
        name: 'SprintOrbital',
        entity: {
          name: 'Sprint',
          persistence: 'persistent',
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'members', type: 'relation', relation: { entity: 'TeamMember', cardinality: 'many' } },
          ],
        },
        traits: [],
        pages: [],
      },
    ];
  }

  it('retargets owner-compared relations (policy or-nesting, both binding forms, persist effect) to the winner', () => {
    const orbitals = ownerRoster();
    const { demotions, relationsRetargeted } = dedupeComposedIdentity(orbitals);

    expect(demotions).toEqual([{ orbitalName: 'TeamMemberOrbital', entityName: 'TeamMember' }]);
    expect(relationsRetargeted).toEqual([
      { orbitalName: 'TaskOrbital', entityName: 'Task', field: 'assignee', fromEntity: 'TeamMember', toEntity: 'OnlineUser' },
      { orbitalName: 'TaskOrbital', entityName: 'Task', field: 'reporter', fromEntity: 'TeamMember', toEntity: 'OnlineUser' },
    ]);

    const task = orbitals[2]!.entity;
    if (task === undefined || isEntityReferenceAny(task)) throw new Error('task entity must stay inline');
    const relationTarget = (name: string) => {
      const f = task.fields.find((fl) => fl.name === name);
      return f !== undefined && f.type === 'relation' ? f.relation.entity : undefined;
    };
    expect(relationTarget('assignee')).toBe('OnlineUser');
    expect(relationTarget('reporter')).toBe('OnlineUser');

    // Policies and effects are NOT rewritten — only the relation targets move.
    expect(task.read_policy).toEqual(['or',
      ['=', ['object/get', '@entity', 'assignee'], '@user.id'],
      ['==', '@entity.assignee', '@user.id'],
    ]);
  });

  it('leaves non-owner-compared relations to the demoted entity untouched (Sprint.members)', () => {
    const orbitals = ownerRoster();
    dedupeComposedIdentity(orbitals);

    const sprint = orbitals[3]!.entity;
    if (sprint === undefined || isEntityReferenceAny(sprint)) throw new Error('sprint entity must stay inline');
    const members = sprint.fields.find((f) => f.name === 'members');
    expect(members !== undefined && members.type === 'relation' ? members.relation.entity : undefined).toBe('TeamMember');
  });

  it('does not mutate the caller\'s original orbital definitions (copy-on-write)', () => {
    const orbitals = ownerRoster();
    const originalTask = orbitals[2]!.entity;
    dedupeComposedIdentity(orbitals);
    if (originalTask === undefined || isEntityReferenceAny(originalTask)) throw new Error('inline entity expected');
    const assignee = originalTask.fields.find((f) => f.name === 'assignee');
    expect(assignee !== undefined && assignee.type === 'relation' ? assignee.relation.entity : undefined).toBe('TeamMember');
  });

  it('no owner comparison against a demoted-target relation → no retargets', () => {
    const orbitals = ownerRoster();
    const task = orbitals[2]!.entity;
    if (task === undefined || isEntityReferenceAny(task)) throw new Error('inline entity expected');
    delete task.read_policy;
    orbitals[2]!.traits = [];

    const { relationsRetargeted } = dedupeComposedIdentity(orbitals);
    expect(relationsRetargeted).toEqual([]);
    const assignee = task.fields.find((f) => f.name === 'assignee');
    expect(assignee !== undefined && assignee.type === 'relation' ? assignee.relation.entity : undefined).toBe('TeamMember');
  });

  it('self-read on the identity\'s own id is not an owner column (field id excluded)', () => {
    const orbitals = ownerRoster();
    const loser = orbitals[1]!.entity;
    if (loser === undefined || isEntityReferenceAny(loser)) throw new Error('inline entity expected');
    loser.read_policy = ['=', ['object/get', '@entity', 'id'], '@user.id'];

    const { relationsRetargeted } = dedupeComposedIdentity(orbitals);
    expect(relationsRetargeted.map((r) => `${r.entityName}.${r.field}`)).not.toContain('TeamMember.id');
  });
});

describe('composeAppFromFiles — per-orbital files composed into one app', () => {
  it('carries the hooks and egress the composed programs and the behaviors they import declare', () => {
    const importer = (name: string, from: string): OrbitalSchema => ({
      name,
      version: '1.0.0',
      orbitals: [{ name, entity: 'App.entity', reference: { ref: 'Up.orbitals.UpOrbital' }, uses: [{ from, as: 'Up' }], traits: [], pages: [] }],
    });
    const upstream: OrbitalSchema = {
      name: 'std-identity',
      version: '1.0.0',
      inbound: ['personas', 'persona-sign-in'],
      egress: ['http://127.0.0.1:9099'],
      orbitals: [],
    };
    const own: OrbitalSchema = { ...importer('ShopOrbital', 'almadar-behaviors/std-shop'), egress: ['https://api.stripe.com', 'http://127.0.0.1:9099'] };
    const out = composeAppFromFiles([importer('AccountPage', 'almadar-behaviors/std-identity'), own], {
      appName: 'Shop',
      importedProgramOf: (orbital) => (orbital.uses?.[0]?.from === 'almadar-behaviors/std-identity' ? upstream : undefined),
    });
    expect(out.schema.inbound).toEqual(['personas', 'persona-sign-in']);
    expect(out.schema.egress).toEqual(['http://127.0.0.1:9099', 'https://api.stripe.com']);
  });

  it('an import orbital takes the os grants its upstream orbital declares, and only those', () => {
    const importOf = (name: string, upstreamName: string): OrbitalSchema => ({
      name,
      version: '1.0.0',
      orbitals: [{ name, entity: 'App.entity', reference: { ref: `Up.orbitals.${upstreamName}` }, uses: [{ from: 'almadar-behaviors/std-up', as: 'Up' }], traits: [], pages: [] }],
    });
    const upstream: Record<string, OrbitalDefinition> = {
      Granted: { name: 'Granted', entity: 'App.entity', osGrants: { env: ['FIREBASE_AUTH_EMULATOR_HOST'] }, traits: [], pages: [] },
      Plain: { name: 'Plain', entity: 'App.entity', traits: [], pages: [] },
    };
    const out = composeAppFromFiles([importOf('AccountPage', 'Granted'), importOf('OtherPage', 'Plain')], {
      appName: 'Granted',
      importedOrbitalOf: (orbital) => upstream[orbital.reference?.ref.split('.')[2] ?? ''],
    });
    const byName = new Map(out.schema.orbitals.map((o) => [o.name, o]));
    expect(byName.get('AccountPage')?.osGrants).toEqual({ env: ['FIREBASE_AUTH_EMULATOR_HOST'] });
    expect(byName.get('OtherPage')?.osGrants, 'control: an upstream that grants nothing gives nothing').toBeUndefined();
  });

  it('control: when nothing declares a hook or an origin the app declares none', () => {
    const plain: OrbitalSchema = { name: 'Plain', version: '1.0.0', orbitals: [{ name: 'PlainOrbital', entity: 'App.entity', traits: [], pages: [] }] };
    const out = composeAppFromFiles([plain], { appName: 'Plain', importedProgramOf: () => undefined });
    expect(out.schema.inbound).toBeUndefined();
    expect(out.schema.egress).toBeUndefined();
  });

  const navOf = (...hrefs: string[]) => ({ type: '[NavItem]', default: hrefs.map((href) => ({ href, label: href })) });
  const organismFile = (orbital: string, path: string, nav: ReturnType<typeof navOf>): OrbitalSchema => ({
    name: orbital,
    version: '1.0.0',
    config: { navItems: nav },
    orbitals: [{
      name: orbital,
      entity: `${orbital}.entity`,
      traits: [{ ref: 'AppShell.traits.AppLayout', name: `${orbital}Layout`, config: { navItems: { type: 'unknown', default: '@config.navItems' } } }],
      pages: [{ name: `${orbital}Page`, path, traits: [{ ref: `${orbital}Layout` }] }],
    }],
  });

  it('renamed trait rows get curName=<renamed> (+renames entry); untouched rows keep curName', () => {
    const fileWith = (orbital: string, traitId: string, path: string): OrbitalSchema => ({
      name: orbital,
      version: '1.0.0',
      orbitals: [{
        name: orbital,
        entity: 'App.entity',
        traits: [{ ref: 'UiTypography.traits.TypographyRender', name: 'InlineTypographyRender2', linkedEntity: 'App', id: asTraitId(traitId) }],
        pages: [{ name: `${orbital}Page`, path, traits: [{ ref: 'InlineTypographyRender2' }] }],
      }],
      ledger: { schemaVersion: 1, entries: { [traitId]: { id: traitId, kind: 'trait', bakedName: 'InlineTypographyRender2', curName: 'InlineTypographyRender2', renames: [], owner: 'workspace' } } },
    });
    const out = composeAppFromFiles([fileWith('NotesOrbital', 'trt_FIRST', '/'), fileWith('VendorDirectoryOrbital', 'trt_SECOND', '/vendors')], { appName: 'LedgerSyncApp' });
    expect(out.surfaceRenames.traits).toHaveLength(1);
    const rename = out.surfaceRenames.traits[0]!;
    expect(rename.id).toBe('trt_SECOND');
    const entries = out.schema.ledger?.entries ?? {};
    expect(entries['trt_FIRST']?.curName).toBe('InlineTypographyRender2');
    expect(entries['trt_SECOND']?.curName).toBe(rename.to);
    expect(entries['trt_SECOND']?.renames).toEqual([expect.objectContaining({ from: 'InlineTypographyRender2', to: rename.to })]);
  });

  it('unions the organisms\' config: nav concatenated, then narrowed to pages this app owns', () => {
    const out = composeAppFromFiles([
      organismFile('ContactOrbital', '/contacts', navOf('/contacts', '/deals')),
      organismFile('EmployeeOrbital', '/employees', navOf('/employees', '/contacts')),
    ], { appName: 'Mixed' });
    expect(out.schema.config?.navItems).toEqual(navOf('/contacts', '/employees'));
    expect(out.configNavItemsNarrowed).toEqual([{ knob: 'navItems', droppedHrefs: ['/deals'] }]);
  });

  it('D32: an orbital declaring the app nav it forwards at orbital level joins the app\'s one list (and stops shadowing it)', () => {
    const orbitalLevel: OrbitalSchema = {
      name: 'EmployeeOrbital',
      version: '1.0.0',
      orbitals: [{
        name: 'EmployeeOrbital',
        entity: 'EmployeeOrbital.entity',
        config: { navItems: navOf('/employees') },
        traits: [{ ref: 'AppShell.traits.AppLayout', name: 'EmployeeOrbitalLayout', config: { navItems: { type: 'unknown', default: '@config.navItems' } } }],
        pages: [{ name: 'EmployeeOrbitalPage', path: '/employees', traits: [{ ref: 'EmployeeOrbitalLayout' }] }],
      }],
    };
    const out = composeAppFromFiles([organismFile('ContactOrbital', '/contacts', navOf('/contacts')), orbitalLevel], { appName: 'Mixed' });
    expect(out.schema.config?.navItems).toEqual(navOf('/contacts', '/employees'));
    expect(out.schema.orbitals.find((o) => o.name === 'EmployeeOrbital')?.config?.navItems).toBeUndefined();
  });

  it('D32 control: an orbital-level [NavItem] knob no trait forwards as @config stays the orbital\'s own', () => {
    const local: OrbitalSchema = {
      name: 'EmployeeOrbital',
      version: '1.0.0',
      orbitals: [{
        name: 'EmployeeOrbital',
        entity: 'EmployeeOrbital.entity',
        config: { tabs: navOf('/employees') },
        traits: [{ ref: 'AppShell.traits.AppLayout', name: 'EmployeeOrbitalLayout', config: { navItems: { type: 'unknown', default: '@config.navItems' } } }],
        pages: [{ name: 'EmployeeOrbitalPage', path: '/employees', traits: [{ ref: 'EmployeeOrbitalLayout' }] }],
      }],
    };
    const out = composeAppFromFiles([organismFile('ContactOrbital', '/contacts', navOf('/contacts')), local], { appName: 'Mixed' });
    expect(out.schema.config?.navItems).toEqual(navOf('/contacts'));
    expect(out.schema.orbitals.find((o) => o.name === 'EmployeeOrbital')?.config?.tabs).toEqual(navOf('/employees'));
  });

  it('control: every listed page owned → concatenated, nothing narrowed', () => {
    const out = composeAppFromFiles([
      organismFile('ContactOrbital', '/contacts', navOf('/contacts')),
      organismFile('EmployeeOrbital', '/employees', navOf('/employees')),
    ], { appName: 'Mixed' });
    expect(out.schema.config?.navItems).toEqual(navOf('/contacts', '/employees'));
    expect(out.configNavItemsNarrowed).toEqual([]);
  });

  // G-CORE-017 — an orbital IMPORT (`orbital X = Agent.orbitals.AgentAssistantOrbital { … }`) has
  // `pages: []` until `orb resolve` expands it; its pages are its source's. Narrowing against the
  // file's own pages alone dropped std-notes' `/assistant` entry and the published app failed
  // ORB_PAGE_UNREACHABLE.
  const assistantSource: OrbitalSchema = {
    name: 'std-agent-assistant',
    version: '1.0.0',
    orbitals: [{ name: 'AgentAssistantOrbital', entity: 'AgentChat', traits: [], pages: [{ name: 'AssistantPage', path: '/assistant', traits: [] }] }],
  };
  const loadBehavior = (name: string): OrbitalSchema | null => (name === 'std-agent-assistant' ? assistantSource : null);
  const importFile = (pages?: Record<string, string>): OrbitalSchema => ({
    name: 'NotesAssistantOrbital',
    version: '1.0.0',
    orbitals: [{
      name: 'NotesAssistantOrbital',
      entity: 'Agent.orbitals.AgentAssistantOrbital.entity',
      reference: { ref: 'Agent.orbitals.AgentAssistantOrbital', ...(pages !== undefined ? { pages } : {}) },
      uses: [{ from: 'std/behaviors/std-agent-assistant', as: 'Agent' }],
      traits: [],
      pages: [],
    }],
  });

  it("an imported orbital owns its source's pages: its nav entry survives, an unowned one is still dropped", () => {
    const out = composeAppFromFiles([
      organismFile('NoteOrbital', '/notes', navOf('/notes', '/assistant', '/gone')),
      importFile(),
    ], { appName: 'Notes', importedOrbitalOf: orbitalImportResolver(loadBehavior) });
    expect(out.schema.config?.navItems).toEqual(navOf('/notes', '/assistant'));
    expect(out.configNavItemsNarrowed).toEqual([{ knob: 'navItems', droppedHrefs: ['/gone'] }]);
  });

  it("an import's page remap is the path it owns", () => {
    const out = composeAppFromFiles([
      organismFile('NoteOrbital', '/notes', navOf('/notes', '/help', '/assistant')),
      importFile({ '/assistant': '/help' }),
    ], { appName: 'Notes', importedOrbitalOf: orbitalImportResolver(loadBehavior) });
    expect(out.schema.config?.navItems).toEqual(navOf('/notes', '/help'));
    expect(out.configNavItemsNarrowed).toEqual([{ knob: 'navItems', droppedHrefs: ['/assistant'] }]);
  });

  const wrapperSource: OrbitalSchema = {
    name: 'std-assistant-page',
    version: '1.0.0',
    orbitals: [{
      name: 'AssistantPageOrbital',
      entity: 'Agent.orbitals.AgentAssistantOrbital.entity',
      reference: { ref: 'Agent.orbitals.AgentAssistantOrbital', pages: { '/assistant': '/ask' } },
      uses: [{ from: 'std/behaviors/std-agent-assistant', as: 'Agent' }],
      traits: [],
      pages: [],
    }],
  };
  const loadNested = (name: string): OrbitalSchema | null => (name === 'std-assistant-page' ? wrapperSource : loadBehavior(name));
  const nestedImportFile = (reference: { pages?: Record<string, string>; omit?: string[] }): OrbitalSchema => ({
    name: 'HelpOrbital',
    version: '1.0.0',
    orbitals: [{
      name: 'HelpOrbital',
      entity: 'Page.orbitals.AssistantPageOrbital.entity',
      reference: { ref: 'Page.orbitals.AssistantPageOrbital', ...reference },
      uses: [{ from: 'almadar-behaviors/std-assistant-page', as: 'Page' }],
      traits: [],
      pages: [],
    }],
  });

  it('a nested import owns the pages its upstream import remaps, through every remap', () => {
    const out = composeAppFromFiles([
      organismFile('NoteOrbital', '/notes', navOf('/notes', '/help', '/ask', '/assistant')),
      nestedImportFile({ pages: { '/ask': '/help' } }),
    ], { appName: 'Notes', importedOrbitalOf: orbitalImportResolver(loadNested) });
    expect(out.schema.config?.navItems).toEqual(navOf('/notes', '/help'));
    expect(out.configNavItemsNarrowed).toEqual([{ knob: 'navItems', droppedHrefs: ['/ask', '/assistant'] }]);
  });

  it('a nested import without its own remap owns the upstream import\'s local path', () => {
    const out = composeAppFromFiles([
      organismFile('NoteOrbital', '/notes', navOf('/notes', '/ask')),
      nestedImportFile({}),
    ], { appName: 'Notes', importedOrbitalOf: orbitalImportResolver(loadNested) });
    expect(out.schema.config?.navItems).toEqual(navOf('/notes', '/ask'));
    expect(out.configNavItemsNarrowed).toEqual([]);
  });

  it('control: a page the import omits is not owned', () => {
    const out = composeAppFromFiles([
      organismFile('NoteOrbital', '/notes', navOf('/notes', '/assistant')),
      { ...importFile(), orbitals: importFile().orbitals.map((o) => ({ ...o, reference: { ...o.reference!, omit: ['/assistant'] } })) },
    ], { appName: 'Notes', importedOrbitalOf: orbitalImportResolver(loadBehavior) });
    expect(out.configNavItemsNarrowed).toEqual([{ knob: 'navItems', droppedHrefs: ['/assistant'] }]);
  });

  it('orbitalImportResolver: the source orbital through the import\'s uses alias; unknown alias or behavior resolves nothing', () => {
    const resolve = orbitalImportResolver(loadBehavior);
    const [declared] = importFile().orbitals;
    expect(resolve(declared!)?.name).toBe('AgentAssistantOrbital');
    expect(resolve({ ...declared!, uses: [] })).toBeUndefined();
    expect(resolve({ ...declared!, uses: [{ from: 'std/behaviors/std-missing', as: 'Agent' }] })).toBeUndefined();
    expect(resolve({ name: 'Plain', entity: 'Plain', traits: [], pages: [] })).toBeUndefined();
  });

  it('control: bare definitions compose exactly as composeBehaviors does (no config, no ledger)', () => {
    const defs: OrbitalDefinition[] = [
      { name: 'A', entity: 'A.entity', traits: [], pages: [{ name: 'APage', path: '/', traits: [] }] },
      { name: 'B', entity: 'B.entity', traits: [], pages: [{ name: 'BPage', path: '/b', traits: [] }] },
    ];
    expect(composeAppFromFiles(defs, { appName: 'Plain' }).schema).toEqual(composeBehaviors({ appName: 'Plain', orbitals: defs }).schema);
  });
});

describe('composeOrbitalSurface — the app surface without generated pages or layout', () => {
  it('keeps the files\' order and generates no page for an orbital without one', () => {
    const files: OrbitalDefinition[] = [
      { name: 'First', entity: 'First.entity', traits: [], pages: [{ name: 'FirstPage', path: '/', traits: [] }] },
      { name: 'Headless', entity: 'Headless.entity', traits: [], pages: [] },
    ];
    const out = composeOrbitalSurface(files);
    expect(out.orbitals.map((o) => o.name)).toEqual(['First', 'Headless']);
    expect(out.orbitals[1]!.pages).toEqual([]);
    expect(composeAppFromFiles(files, { appName: 'Gen' }).schema.orbitals[1]!.pages).not.toEqual([]);
  });

  it('does not mutate the caller\'s files', () => {
    const files: OrbitalDefinition[] = [
      { name: 'A', entity: 'A.entity', traits: [{ ref: 'X.traits.Y', name: 'InlineRender1' }], pages: [{ name: 'P', path: '/', traits: [] }] },
      { name: 'B', entity: 'B.entity', traits: [{ ref: 'X.traits.Y', name: 'InlineRender1' }], pages: [{ name: 'Q', path: '/', traits: [] }] },
    ];
    const before = JSON.stringify(files);
    composeOrbitalSurface(files);
    expect(JSON.stringify(files)).toBe(before);
  });
});

describe('composeOrbitalSurface — a renamed route stays reachable through its own organism\'s nav', () => {
  const navOf = (...hrefs: string[]) => ({ type: '[NavItem]', default: hrefs.map((href) => ({ href, label: href })) });
  // A rename moves the href; the entry's label is the organism's own and stays.
  const renamed = { type: '[NavItem]', default: [{ href: '/wiki', label: '/wiki' }, { href: '/people', label: '/people' }, { href: '/events', label: '/events' }, { href: '/person', label: '/people' }] };
  // With organisms known, the later organism's colliding route moves under its own path instead.
  const namespaced = { type: '[NavItem]', default: [{ href: '/wiki', label: '/wiki' }, { href: '/people', label: '/people' }, { href: '/events', label: '/events' }, { href: '/events/people', label: '/people' }] };
  const file = (orbital: string, path: string, nav: ReturnType<typeof navOf>): OrbitalSchema => ({
    name: orbital,
    version: '1.0.0',
    config: { navItems: nav },
    orbitals: [{ name: orbital, entity: `${orbital}.entity`, traits: [], pages: [{ name: `${orbital}Page`, path, traits: [] }] }],
  });
  // wiki owns /people first; the events organism also ships a /people page, renamed on compose.
  const files = [
    file('ContributorOrbital', '/people', navOf('/wiki', '/people')),
    file('WikiOrbital', '/wiki', navOf('/wiki', '/people')),
    file('EventOrbital', '/events', navOf('/events', '/people')),
    file('PersonOrbital', '/people', navOf('/events', '/people')),
  ];
  const organisms: Record<string, string> = { ContributorOrbital: 'wiki', WikiOrbital: 'wiki', EventOrbital: 'events', PersonOrbital: 'events' };

  it('the renaming organism\'s nav entries follow the rename, so both pages are listed', () => {
    const out = composeOrbitalSurface(files, { organismOf: (name) => organisms[name] });
    expect(out.organismRenames).toEqual([{ organism: 'events', entities: [], collections: [], routes: [{ from: '/people', to: '/events/people' }] }]);
    expect(out.config?.navItems).toEqual(namespaced);
  });

  it('control: the first claimant\'s organism keeps its entry', () => {
    const out = composeOrbitalSurface(files, { organismOf: (name) => organisms[name] });
    const list = out.config?.navItems?.default;
    const hrefs = Array.isArray(list) ? list.map((item: TraitConfigValue) => navItemHref(item)) : [];
    expect(hrefs.filter((h) => h === '/people')).toHaveLength(1);
  });

  it('without organism identity a file\'s nav follows only its own orbital\'s rename', () => {
    const out = composeOrbitalSurface(files);
    expect(out.config?.navItems).toEqual(renamed);
  });
});

describe('dedupeComposedIdentity — a demoted identity\'s declared vocabulary joins the winner\'s', () => {
  const identityOrbital = (name: string, entity: string, roles: string[]): OrbitalDefinition => ({
    name,
    entity: { name: entity, persistence: 'persistent', identity: true, fields: [{ name: 'id', type: 'string' }, { name: 'role', type: 'string', values: roles }] },
    traits: [],
    pages: [],
  });

  it('roles the demoted organism declares but compares only through config (an atom\'s allowedRoles) stay live', () => {
    const orbitals = [identityOrbital('BillingStaffOrbital', 'BillingStaff', ['billing-admin']), identityOrbital('PlannerOrbital', 'Planner', ['team-lead', 'planner'])];
    const { roleUnions } = dedupeComposedIdentity(orbitals);
    const winner = orbitals[0]!.entity;
    const role = winner !== undefined && !isEntityReferenceAny(winner) ? winner.fields.find((f) => f.name === 'role') : undefined;
    expect(role !== undefined && 'values' in role ? role.values : null).toEqual(['billing-admin', 'planner', 'team-lead']);
    expect(roleUnions).toEqual([{ orbitalName: 'BillingStaffOrbital', entityName: 'BillingStaff', field: 'role', addedLiterals: ['planner', 'team-lead'] }]);
  });

  it('control: a single identity unions nothing', () => {
    const orbitals = [identityOrbital('BillingStaffOrbital', 'BillingStaff', ['billing-admin'])];
    expect(dedupeComposedIdentity(orbitals).roleUnions).toEqual([]);
  });
});

describe('dedupeComposedIdentity — FIX-L keeps a rewritten expectation true to what the orbital writes', () => {
  const presence = (persisted: boolean): Trait => ({
    name: 'OnlinePresence',
    linkedEntity: 'OnlineUser',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [{ key: 'PING', name: 'Ping' }],
      transitions: [{ from: 'idle', to: 'idle', event: 'PING', effects: persisted ? [['persist', 'update', 'OnlineUser', { lastActive: '@now' }]] : [] }],
    },
  });
  const roster = (persisted: boolean): OrbitalDefinition[] => [
    { name: 'StaffOrbital', entity: { name: 'Staff', persistence: 'persistent', identity: true, fields: [{ name: 'id', type: 'string' }] }, traits: [], pages: [] },
    {
      name: 'OnlineUserOrbital',
      entity: { name: 'OnlineUser', persistence: 'persistent', identity: true, fields: [{ name: 'id', type: 'string' }, { name: 'email', type: 'string' }, { name: 'lastActive', type: 'timestamp' }] },
      expects: [{ kind: 'identity', name: 'OnlineUser', shape: [{ name: 'email', type: 'string' }] }],
      traits: [presence(persisted)],
      pages: [],
    },
  ];

  it('a field the orbital persists to the demoted entity joins the shape, typed from that entity', () => {
    const orbitals = roster(true);
    dedupeComposedIdentity(orbitals);
    expect(orbitals[1]!.expects?.filter(e => e.kind === 'entity')).toEqual([{ kind: 'entity', name: 'OnlineUser', shape: [{ name: 'email', type: 'string' }, { name: 'lastActive', type: 'timestamp' }] }]);
  });

  it('control: nothing persisted → the shape is carried as declared', () => {
    const orbitals = roster(false);
    dedupeComposedIdentity(orbitals);
    expect(orbitals[1]!.expects?.filter(e => e.kind === 'entity')).toEqual([{ kind: 'entity', name: 'OnlineUser', shape: [{ name: 'email', type: 'string' }] }]);
  });
});

describe('dedupeComposedSurface — page names stay unique across orbitals', () => {
  const orbital = (name: string, pageName: string, path: string): OrbitalDefinition => ({
    name, entity: `${name}.entity`, traits: [], pages: [{ name: pageName, path, traits: [] }],
  });

  it('keeps the first claimant\'s page name and prefixes the second with its orbital', () => {
    const orbitals = [orbital('ContributorOrbital', 'People', '/people'), orbital('PersonOrbital', 'People', '/person')];
    const { pageNames } = dedupeComposedSurface(orbitals);
    expect(pageNames).toEqual([{ orbitalName: 'PersonOrbital', from: 'People', to: 'PersonPeople' }]);
    const pageName = (o: OrbitalDefinition): string | null => {
      const first = o.pages[0];
      return typeof first === 'object' && first !== null && 'name' in first && typeof first.name === 'string' ? first.name : null;
    };
    expect(orbitals.map(pageName)).toEqual(['People', 'PersonPeople']);
  });

  it('control: distinct page names → nothing renamed', () => {
    const orbitals = [orbital('A', 'APage', '/a'), orbital('B', 'BPage', '/b')];
    expect(dedupeComposedSurface(orbitals).pageNames).toEqual([]);
  });
});

describe('composeOrbitalSurface — every organism\'s landing page stays reachable', () => {
  const navOf = (...hrefs: string[]) => ({ type: '[NavItem]', default: hrefs.map((href) => ({ href, label: href })) });
  const file = (orbital: string, pageName: string, path: string, hrefs: string[]): OrbitalSchema => ({
    name: orbital,
    version: '1.0.0',
    config: { navItems: navOf(...hrefs) },
    orbitals: [{ name: orbital, entity: `${orbital}.entity`, traits: [], pages: [{ name: pageName, path, traits: [] }] }],
  });
  const organisms: Record<string, string> = { BillingOrbital: 'billing', PlannerPersonOrbital: 'planner', WorkloadOrbital: 'planner' };

  it('a non-booting organism\'s unlinked landing page joins the nav, labelled by its page name', () => {
    const out = composeOrbitalSurface([
      file('BillingOrbital', 'Billing', '/billing', ['/billing']),
      file('PlannerPersonOrbital', 'TeamMembers', '/team-members', ['/workload']),
      file('WorkloadOrbital', 'Workload', '/workload', ['/workload']),
    ], { organismOf: (name) => organisms[name] });
    // In roster order: the planner landing (orbital 1) sits ahead of Workload's entry (orbital 2).
    expect(out.config?.navItems).toEqual({ type: '[NavItem]', default: [{ href: '/billing', label: '/billing' }, { href: '/team-members', label: 'Team Members' }, { href: '/workload', label: '/workload' }] });
    expect(out.landingNavAdded).toEqual([{ organism: 'planner', href: '/team-members' }]);
  });

  it('an earlier orbital\'s landing entry stays ahead of a later organism\'s nav (marketplace + added chat)', () => {
    const bare = (orbital: string, pageName: string, path: string): OrbitalSchema => ({
      name: orbital,
      version: '1.0.0',
      orbitals: [{ name: orbital, entity: `${orbital}.entity`, traits: [], pages: [{ name: pageName, path, traits: [] }] }],
    });
    const owners: Record<string, string> = { ListingOrbital: 'market', OfferOrbital: 'OfferOrbital', ChatOrbital: 'chat' };
    const out = composeOrbitalSurface([
      file('ListingOrbital', 'Listings', '/listings', ['/listings']),
      bare('OfferOrbital', 'Offers', '/offer'),
      file('ChatOrbital', 'Chat', '/chat', ['/chat']),
    ], { organismOf: (name) => owners[name] });
    const hrefs = (out.config?.navItems?.default as Array<{ href: string }>).map((n) => n.href);
    expect(hrefs).toEqual(['/listings', '/offer', '/chat']);
  });

  it('links every orbital of an organism that declares no nav of its own (free-composed lines, a reused atom)', () => {
    const bare = (orbital: string, pageName: string, path: string): OrbitalSchema => ({
      name: orbital,
      version: '1.0.0',
      orbitals: [{ name: orbital, entity: `${orbital}.entity`, traits: [], pages: [{ name: pageName, path, traits: [] }] }],
    });
    const owners: Record<string, string> = {
      ListingOrbital: 'market',
      OfferOrbital: 'free-lolo',
      ReviewOrbital: 'free-lolo',
      WorkoutLogOrbital: 'std-browse',
      FitnessGoalOrbital: 'std-browse',
    };
    const out = composeOrbitalSurface([
      file('ListingOrbital', 'Listings', '/listings', ['/listings']),
      bare('OfferOrbital', 'Offers', '/offers'),
      bare('ReviewOrbital', 'Reviews', '/reviews'),
      bare('WorkoutLogOrbital', 'Workouts', '/workouts'),
      bare('FitnessGoalOrbital', 'Goals', '/goals'),
    ], { organismOf: (name) => owners[name] });
    const hrefs = (out.config?.navItems?.default as Array<{ href: string }>).map((n) => n.href);
    expect(hrefs).toEqual(['/listings', '/offers', '/reviews', '/workouts', '/goals']);
  });

  it("a route rename never rewrites another file's nav entry for its OWN page (one atom backing two lines)", () => {
    const own = (orbital: string, pageName: string, path: string): OrbitalSchema => ({
      name: orbital,
      version: '1.0.0',
      config: { navItems: navOf(path) },
      orbitals: [{ name: orbital, entity: `${orbital}.entity`, traits: [], pages: [{ name: pageName, path, traits: [] }] }],
    });
    const owners: Record<string, string> = { WorkoutLogOrbital: 'std-browse', FitnessGoalOrbital: 'std-browse' };
    const out = composeOrbitalSurface(
      [own('WorkoutLogOrbital', 'Workouts', '/browseitems'), own('FitnessGoalOrbital', 'Goals', '/browseitems')],
      { organismOf: (name) => owners[name] },
    );
    const goalPath = (out.orbitals[1]!.pages![0] as { path: string }).path;
    expect(goalPath).not.toBe('/browseitems');
    const hrefs = (out.config?.navItems?.default as Array<{ href: string }>).map((n) => n.href);
    expect(hrefs).toEqual(['/browseitems', goalPath]);
  });

  // G-CORE-018 — the roster took Workload before PlannerPerson; the planner organism DECLARES
  // PlannerPerson first, so `/team-members` is its boot page and its own nav never links it.
  const declared: Record<string, number> = { PlannerPersonOrbital: 0, WorkloadOrbital: 1 };
  const plannerAfterWorkload = () => [
    file('BillingOrbital', 'Billing', '/billing', ['/billing']),
    file('WorkloadOrbital', 'Workload', '/workload', ['/workload']),
    file('PlannerPersonOrbital', 'TeamMembers', '/team-members', ['/workload']),
  ];

  it("the organism's DECLARED first orbital is its landing, whatever the roster order", () => {
    const out = composeOrbitalSurface(plannerAfterWorkload(), {
      organismOf: (name) => organisms[name],
      organismOrderOf: (name) => declared[name],
    });
    expect(out.landingNavAdded).toEqual([{ organism: 'planner', href: '/team-members' }]);
  });

  it('control: without declared order the first composed orbital stands in for the landing', () => {
    const out = composeOrbitalSurface(plannerAfterWorkload(), { organismOf: (name) => organisms[name] });
    expect(out.landingNavAdded).toEqual([]);
  });

  it('control: a landing page its organism already links is left alone', () => {
    const out = composeOrbitalSurface([
      file('BillingOrbital', 'Billing', '/billing', ['/billing']),
      file('PlannerPersonOrbital', 'TeamMembers', '/team-members', ['/team-members', '/workload']),
      file('WorkloadOrbital', 'Workload', '/workload', ['/workload']),
    ], { organismOf: (name) => organisms[name] });
    expect(out.landingNavAdded).toEqual([]);
  });

  it('control: without organism identity no landing page is inferred', () => {
    const out = composeOrbitalSurface([
      file('BillingOrbital', 'Billing', '/billing', ['/billing']),
      file('PlannerPersonOrbital', 'TeamMembers', '/team-members', ['/workload']),
    ]);
    expect(out.landingNavAdded).toEqual([]);
  });
});

describe('composeOrbitalSurface — organisms are namespaces', () => {
  const file = (orbital: string, entity: string, extra: Partial<OrbitalDefinition> = {}, collection?: string): OrbitalSchema => ({
    name: orbital,
    version: '1.0.0',
    orbitals: [{
      name: orbital,
      entity: { name: entity, persistence: 'persistent', ...(collection !== undefined ? { collection } : {}), fields: [{ name: 'id', type: 'string' }] },
      traits: [],
      pages: [{ name: `${orbital}Page`, path: `/${orbital.toLowerCase()}`, traits: [] }],
      ...extra,
    }],
  });
  const organisms: Record<string, string> = { StaffOrbital: 'std-ats-recruiting', InterviewOrbital: 'std-ats-recruiting', HrPortalStaffOrbital: 'std-hr-portal', LeaveOrbital: 'std-hr-portal' };
  const atomTraitOf = (_o: OrbitalDefinition, ref: string): Trait => ({ name: ref, entityRebindable: ref !== 'Fixed.traits.Board' });
  const app = (pinned = false): OrbitalSchema[] => [
    file('StaffOrbital', 'Staff', {}, 'staff'),
    file('InterviewOrbital', 'Interview'),
    file('HrPortalStaffOrbital', 'Staff', pinned ? { traits: [{ ref: 'Fixed.traits.Board', name: 'StaffBoard', linkedEntity: 'Staff' }] } : {}, 'staff'),
    file('LeaveOrbital', 'Leave', { entity: { name: 'Leave', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }, { name: 'employee', type: 'relation', relation: { entity: 'Staff' } }] }, traits: [{ ref: 'Browse.traits.List', name: 'LeaveList', linkedEntity: 'Leave' }] }),
  ];

  it('the later organism\'s colliding entity is prefixed, with every reference in its own files', () => {
    const out = composeOrbitalSurface(app(), { organismOf: (n) => organisms[n], atomTraitOf });
    const hrStaff = out.orbitals.find((o) => o.name === 'HrPortalStaffOrbital')!;
    expect(hrStaff.entity).toMatchObject({ name: 'HrPortalStaff', collection: 'hr_portal_staff' });
    expect(JSON.stringify(out.orbitals.find((o) => o.name === 'LeaveOrbital'))).toContain('"relation":{"entity":"HrPortalStaff"}');
    expect(out.organismRenames).toEqual([{ organism: 'std-hr-portal', entities: [{ from: 'Staff', to: 'HrPortalStaff' }], collections: [{ from: 'staff', to: 'hr_portal_staff' }], routes: [] }]);
  });

  it('control: the first organism keeps its names', () => {
    const out = composeOrbitalSurface(app(), { organismOf: (n) => organisms[n], atomTraitOf });
    expect(out.orbitals.find((o) => o.name === 'StaffOrbital')!.entity).toMatchObject({ name: 'Staff', collection: 'staff' });
  });

  it('control: no collision → the surface is the same as without namespacing', () => {
    const plain = [file('StaffOrbital', 'Staff', {}, 'staff'), file('LeaveOrbital', 'Leave')];
    expect(composeOrbitalSurface(plain, { organismOf: (n) => organisms[n], atomTraitOf }).orbitals).toEqual(composeOrbitalSurface(plain).orbitals);
  });

  it('a collision an atom pins is reported, not renamed', () => {
    const out = composeOrbitalSurface(app(true), { organismOf: (n) => organisms[n], atomTraitOf });
    expect(out.orbitals.find((o) => o.name === 'HrPortalStaffOrbital')!.entity).toMatchObject({ name: 'Staff' });
    expect(out.unrenamableCollisions).toEqual([{ organism: 'std-hr-portal', entity: 'Staff', blockers: [{ orbitalName: 'HrPortalStaffOrbital', traitName: 'StaffBoard', traitRef: 'Fixed.traits.Board' }] }]);
  });
});

describe('composeOrbitalSurface — an atom\'s implicit entity cannot move, so a declared one yields', () => {
  const organisms: Record<string, string> = { MembershipOrbital: 'std-fitness-studio', SubscriptionOrbital: 'std-subscription-billing' };
  const atomTraitOf = (_o: OrbitalDefinition, ref: string): Trait | undefined => (ref === 'Billing.traits.SubscriptionPanel'
    ? { name: 'SubscriptionPanel', linkedEntity: 'Subscription', entityRebindable: true }
    : { name: ref, entityRebindable: true });
  const files = (explicit: boolean): OrbitalSchema[] => [
    { name: 'MembershipOrbital', version: '1.0.0', orbitals: [{ name: 'MembershipOrbital', entity: { name: 'Membership', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] }, auxiliaryEntities: [{ name: 'Subscription', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }, { name: 'searchTerm', type: 'string' }] }], traits: [{ ref: 'AppSearch.traits.AppSearch', name: 'MembershipSearch', linkedEntity: 'Subscription' }], pages: [{ name: 'Memberships', path: '/memberships', traits: [] }] }] },
    { name: 'SubscriptionOrbital', version: '1.0.0', orbitals: [{ name: 'SubscriptionOrbital', entity: { name: 'Plan', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] }, traits: [{ ref: 'Billing.traits.SubscriptionPanel', name: 'Panel', ...(explicit ? { linkedEntity: 'Plan' } : {}) }], pages: [{ name: 'Plans', path: '/plans', traits: [] }] }] },
  ];

  it('the earlier organism\'s declared entity takes its prefix when a later atom brings the name implicitly', () => {
    const out = composeOrbitalSurface(files(false), { organismOf: (n) => organisms[n], atomTraitOf });
    const membership = out.orbitals.find((o) => o.name === 'MembershipOrbital')!;
    expect(JSON.stringify(membership.auxiliaryEntities)).toContain('"name":"FitnessStudioSubscription"');
    expect(membership.traits[0]).toMatchObject({ linkedEntity: 'FitnessStudioSubscription' });
    expect(out.organismRenames).toEqual([{ organism: 'std-fitness-studio', entities: [{ from: 'Subscription', to: 'FitnessStudioSubscription' }], collections: [], routes: [] }]);
  });

  it('control: an explicit binding brings no implicit entity, so nothing collides', () => {
    const out = composeOrbitalSurface(files(true), { organismOf: (n) => organisms[n], atomTraitOf });
    expect(out.organismRenames).toEqual([]);
  });
});

describe('composeOrbitalSurface — renames reach references in sibling orbitals', () => {
  const trait = (name: string, extra: Partial<Trait> = {}): Trait => ({ name, ...extra });
  it('a renamed trait is renamed in every listen sourced from it, in any orbital', () => {
    const files: OrbitalDefinition[] = [
      { name: 'AlarmOrbital', entity: 'Alarm.entity', traits: [trait('AlertPersistor')], pages: [{ name: 'A', path: '/a', traits: [] }] },
      { name: 'DeviceAlertOrbital', entity: 'DeviceAlert.entity', traits: [trait('AlertPersistor')], pages: [{ name: 'B', path: '/b', traits: [] }] },
      { name: 'IncidentOrbital', entity: 'Incident.entity', traits: [trait('IncidentPersistor', { listens: [{ event: 'ALERT_CREATED', triggers: 'ALERT_CREATED', source: { kind: 'orbital', orbital: 'DeviceAlertOrbital', trait: 'AlertPersistor' } }, { event: 'X', triggers: 'X', source: { kind: 'orbital', orbital: 'AlarmOrbital', trait: 'AlertPersistor' } }] })], pages: [{ name: 'C', path: '/c', traits: [] }] },
    ];
    const out = composeOrbitalSurface(files);
    const renamed = out.surfaceRenames.traits.find((r) => r.orbitalName === 'DeviceAlertOrbital')!;
    const listens = JSON.stringify(out.orbitals[2]!.traits);
    expect(listens).toContain(`"orbital":"DeviceAlertOrbital","trait":"${renamed.to}"`);
    // control: the first claimant's listen keeps its trait name
    expect(listens).toContain('"orbital":"AlarmOrbital","trait":"AlertPersistor"');
  });

  it('a renamed route is followed by its organism\'s sibling navigate targets; another organism\'s are not', () => {
    const navigateTo = (path: string): Trait => trait('Nav', { stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'GO', name: 'Go' }], transitions: [{ from: 'idle', to: 'idle', event: 'GO', effects: [['navigate', path]] }] } });
    const files: OrbitalDefinition[] = [
      { name: 'CrmProjectOrbital', entity: 'CrmProject.entity', traits: [], pages: [{ name: 'CrmProjects', path: '/projects', traits: [] }] },
      { name: 'CrmHomeOrbital', entity: 'CrmHome.entity', traits: [navigateTo('/projects')], pages: [{ name: 'CrmHome', path: '/crm', traits: [] }] },
      { name: 'ProjectOrbital', entity: 'Project.entity', traits: [], pages: [{ name: 'Projects', path: '/projects', traits: [] }] },
      { name: 'BoardOrbital', entity: 'Board.entity', traits: [navigateTo('/projects')], pages: [{ name: 'Board', path: '/board', traits: [] }] },
    ];
    const organisms: Record<string, string> = { CrmProjectOrbital: 'crm', CrmHomeOrbital: 'crm', ProjectOrbital: 'pm', BoardOrbital: 'pm' };
    const out = composeOrbitalSurface(files, { organismOf: (n) => organisms[n] });
    expect(out.organismRenames).toEqual([{ organism: 'pm', entities: [], collections: [], routes: [{ from: '/projects', to: '/pm/projects' }] }]);
    expect(JSON.stringify(out.orbitals[3]!.traits)).toContain('["navigate","/pm/projects"]');
    expect(JSON.stringify(out.orbitals[1]!.traits)).toContain('["navigate","/projects"]');
  });
});

describe('composeOrbitalSurface — a later organism\'s colliding routes move under its own path', () => {
  const nav = (...targets: string[]): Trait => ({ name: 'Nav', stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'GO', name: 'Go' }], transitions: targets.map((t, i) => ({ from: 'idle', to: 'idle', event: 'GO', guard: ['=', i, i], effects: [['navigate', t]] })) } });
  const files = (): OrbitalDefinition[] => [
    { name: 'CrmProjectOrbital', entity: 'CrmProject.entity', traits: [], pages: [{ name: 'CrmProjects', path: '/projects', traits: [] }, { name: 'CrmProject', path: '/projects/:id', traits: [] }] },
    { name: 'ProjectOrbital', entity: 'Project.entity', traits: [nav('/projects/@payload.id')], pages: [{ name: 'Projects', path: '/projects', traits: [] }, { name: 'Project', path: '/projects/:id', traits: [] }, { name: 'Team', path: '/projects/:id/team', traits: [] }, { name: 'Templates', path: '/project-templates', traits: [] }] },
    { name: 'BoardOrbital', entity: 'Board.entity', traits: [nav('/projects', '/projectsx')], pages: [{ name: 'Board', path: '/board', traits: [] }] },
  ];
  const organisms: Record<string, string> = { CrmProjectOrbital: 'std-crm', ProjectOrbital: 'std-project-manager', BoardOrbital: 'std-project-manager' };

  it('every route under the colliding root keeps its segments and parameters, prefixed by the organism', () => {
    const out = composeOrbitalSurface(files(), { organismOf: (n) => organisms[n] });
    const paths = (out.orbitals[1]!.pages ?? []).map((p) => (typeof p === 'object' && 'path' in p ? p.path : null));
    expect(paths).toEqual(['/project-manager/projects', '/project-manager/projects/:id', '/project-manager/projects/:id/team', '/project-templates']);
  });

  it('the organism\'s links follow on a segment boundary, dynamic ones included', () => {
    const out = composeOrbitalSurface(files(), { organismOf: (n) => organisms[n] });
    expect(JSON.stringify(out.orbitals[1]!.traits)).toContain('["navigate","/project-manager/projects/@payload.id"]');
    expect(JSON.stringify(out.orbitals[2]!.traits)).toContain('["navigate","/project-manager/projects"]');
    expect(JSON.stringify(out.orbitals[2]!.traits)).toContain('["navigate","/projectsx"]');
  });

  it('control: the first organism keeps its routes', () => {
    const out = composeOrbitalSurface(files(), { organismOf: (n) => organisms[n] });
    expect((out.orbitals[0]!.pages ?? []).map((p) => (typeof p === 'object' && 'path' in p ? p.path : null))).toEqual(['/projects', '/projects/:id']);
  });
});

describe('composeOrbitalSurface — two organisms bringing one atom\'s entity implicitly', () => {
  const organisms: Record<string, string> = { DeploymentOrbital: 'std-cicd', ExpenseOrbital: 'std-accounting' };
  const atomTraitOf = (): Trait => ({ name: 'ApprovalGateReview', linkedEntity: 'ApprovalRequest', entityRebindable: true });
  // `typeArgs` is not declared on `TraitRef` (G-CORE-016): the fixture enters as parsed JSON, as a `.orb` does.
  const files = (secondArgs: Record<string, string>): OrbitalDefinition[] => JSON.parse(JSON.stringify([
    { name: 'DeploymentOrbital', entity: 'Deployment.entity', uses: [{ from: 'std/behaviors/std-approval-gate', as: 'Approval' }], traits: [{ ref: 'Approval.traits.ApprovalGateReview', name: 'DeploymentApproval', typeArgs: { p: 'Deployment' } }], pages: [{ name: 'D', path: '/d', traits: [] }] },
    { name: 'ExpenseOrbital', entity: 'Expense.entity', uses: [{ from: 'std/behaviors/std-approval-gate', as: 'Approval' }], traits: [{ ref: 'Approval.traits.ApprovalGateReview', name: 'ExpenseApproval', typeArgs: secondArgs }], pages: [{ name: 'E', path: '/e', traits: [] }] },
  ]));

  it('different type arguments materialize different entities: a pinned collision, reported', () => {
    const out = composeOrbitalSurface(files({ p: 'Expense' }), { organismOf: (n) => organisms[n], atomTraitOf });
    expect(out.unrenamableCollisions).toEqual([{ organism: 'std-accounting', entity: 'ApprovalRequest', blockers: [{ orbitalName: 'ExpenseOrbital', traitName: 'ExpenseApproval', traitRef: 'Approval.traits.ApprovalGateReview' }] }]);
  });

  it('control: the same atom with the same arguments is one entity, shared without a report', () => {
    const out = composeOrbitalSurface(files({ p: 'Deployment' }), { organismOf: (n) => organisms[n], atomTraitOf });
    expect(out.unrenamableCollisions).toEqual([]);
  });
});

describe('organismOrderResolver — declared position by catalog orbital (G-CORE-018)', () => {
  const planner: OrbitalSchema = {
    name: 'std-capacity-planner',
    orbitals: [
      { name: 'PlannerPersonOrbital', entity: 'PlannerPerson', traits: [], pages: [] },
      { name: 'CapacityPlannerOrbital', entity: 'CapacityTask', traits: [], pages: [] },
    ],
  };
  const sources: Record<string, { organism: string; orbital: string }> = {
    PlannerPersonOrbital: { organism: 'std-capacity-planner', orbital: 'PlannerPersonOrbital' },
    WorkloadOrbital: { organism: 'std-capacity-planner', orbital: 'CapacityPlannerOrbital' },
    GoneOrbital: { organism: 'std-missing', orbital: 'GoneOrbital' },
  };
  let loads = 0;
  const orderOf = organismOrderResolver((name) => sources[name], (organism) => {
    loads += 1;
    return organism === 'std-capacity-planner' ? planner : null;
  });

  it('a renamed line keeps its catalog orbital\'s position; the organism loads once', () => {
    expect(orderOf('PlannerPersonOrbital')).toBe(0);
    expect(orderOf('WorkloadOrbital')).toBe(1);
    expect(loads).toBe(1);
  });

  it('control: no catalog source, or an organism the registry lacks, has no position', () => {
    expect(orderOf('FreeOrbital')).toBeUndefined();
    expect(orderOf('GoneOrbital')).toBeUndefined();
  });
});

describe('unionOsGrants', () => {
  it('unions modes on a shared glob and kinds on a shared target, lists deduplicated in first-seen order', () => {
    expect(unionOsGrants(
      { fs: [{ glob: '~/.a/**', modes: ['read'] }], net: [{ target: '127.0.0.1:9099', kinds: ['tcp'] }], env: ['A', 'B'] },
      { fs: [{ glob: '~/.a/**', modes: ['write', 'read'] }, { glob: './x', modes: ['meta'] }], net: [{ target: '127.0.0.1:9099', kinds: ['tcp'] }], env: ['B', 'C'] },
    )).toEqual({
      fs: [{ glob: '~/.a/**', modes: ['read', 'write'] }, { glob: './x', modes: ['meta'] }],
      net: [{ target: '127.0.0.1:9099', kinds: ['tcp'] }],
      env: ['A', 'B', 'C'],
    });
  });

  it('edge: nothing on either side is no grant at all, and one side alone is itself', () => {
    expect(unionOsGrants(undefined, undefined)).toEqual({});
    expect(unionOsGrants({ exec: ['git'] }, undefined)).toEqual({ exec: ['git'] });
    expect(unionOsGrants(undefined, { stdio: ['out'] })).toEqual({ stdio: ['out'] });
  });
});
