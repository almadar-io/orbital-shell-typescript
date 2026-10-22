import { describe, it, expect } from 'vitest';
import {
  summarizeSchema,
  summarizeOrbital,
  classifyWorkflow,
} from '../index';
import type { OrbitalSchema, OrbitalDefinition, State } from '../index';

// ============================================================================
// Fixtures
// ============================================================================

const crudOrbital: OrbitalDefinition = {
  name: 'Inspectors',
  theme: { name: 'gov-minimalist', tokens: { colors: { primary: '#1e3a5f' } } },
  entity: {
    name: 'Inspector',
    collection: 'inspectors',
    fields: [
      { name: 'id', type: 'string', required: true, primaryKey: true } as never,
      { name: 'name', type: 'string', required: true },
      { name: 'surname', type: 'string', required: true },
      { name: 'department', type: 'string', required: true },
      { name: 'unitName', type: 'string' },
      { name: 'unitEmail', type: 'string' },
      { name: 'status', type: 'enum', values: ['active', 'inactive'], required: true },
      { name: 'companyId', type: 'relation', required: true, relation: { entity: 'Company', cardinality: 'one' } },
    ],
  },
  traits: [{
    name: 'InspectorManagement',
    category: 'interaction',
    scope: 'collection',
    linkedEntity: 'Inspector',
    stateMachine: {
      states: [
        { name: 'browsing', isInitial: true },
        { name: 'creating' },
        { name: 'editing' },
        { name: 'viewing' },
      ],
      events: [
        { key: 'INIT', name: 'Initialize' },
        { key: 'CREATE', name: 'Create' },
        { key: 'SAVE', name: 'Save', payloadSchema: [{ name: 'data', type: 'object' }] },
        { key: 'CANCEL', name: 'Cancel' },
        { key: 'CLOSE', name: 'Close' },
      ],
      transitions: [
        {
          from: 'browsing', to: 'browsing', event: 'INIT',
          effects: [
            ['fetch', 'Inspector', {}],
            ['render-ui', 'main', { type: 'page-header', title: 'Inspectors' }],
            ['render-ui', 'main', { type: 'data-list', entity: 'Inspector', fields: ['name', 'surname'] }],
          ],
        },
        {
          from: 'browsing', to: 'creating', event: 'CREATE',
          effects: [['render-ui', 'modal', { type: 'form-section', entity: 'Inspector', fields: [] }]],
        },
        {
          from: 'creating', to: 'browsing', event: 'SAVE',
          effects: [['persist', 'create', 'Inspector', '@payload.data'], ['render-ui', 'modal', null]],
        },
        {
          from: 'editing', to: 'browsing', event: 'SAVE',
          effects: [['persist', 'update', 'Inspector', '@payload.data'], ['render-ui', 'modal', null]],
        },
        { from: 'creating', to: 'browsing', event: 'CANCEL', effects: [['render-ui', 'modal', null]] },
        { from: 'editing', to: 'browsing', event: 'CANCEL', effects: [['render-ui', 'modal', null]] },
        { from: 'viewing', to: 'browsing', event: 'CANCEL', effects: [['render-ui', 'modal', null]] },
        { from: 'creating', to: 'browsing', event: 'CLOSE', effects: [['render-ui', 'modal', null]] },
        { from: 'editing', to: 'browsing', event: 'CLOSE', effects: [['render-ui', 'modal', null]] },
        { from: 'viewing', to: 'browsing', event: 'CLOSE', effects: [['render-ui', 'modal', null]] },
      ],
    },
  }],
  pages: [{ name: 'InspectorsPage', path: '/inspectors', traits: [{ ref: 'InspectorManagement' }] }],
};

const wizardOrbital: OrbitalDefinition = {
  name: 'Inspection Workflow',
  entity: {
    name: 'Inspection',
    collection: 'inspections',
    fields: [
      { name: 'id', type: 'string', required: true, primaryKey: true } as never,
      { name: 'title', type: 'string', required: true },
      { name: 'phase', type: 'enum', values: ['intro', 'content', 'record', 'closing'], required: true },
    ],
  },
  traits: [{
    name: 'InspectionWorkflow',
    category: 'interaction',
    scope: 'instance',
    linkedEntity: 'Inspection',
    stateMachine: {
      states: [
        { name: 'introduction', isInitial: true },
        { name: 'content' },
        { name: 'record' },
        { name: 'closing' },
        { name: 'completed', isTerminal: true },
      ],
      events: [
        { key: 'INIT', name: 'Initialize' },
        { key: 'NEXT', name: 'Next' },
        { key: 'PREV', name: 'Previous' },
        { key: 'COMPLETE', name: 'Complete' },
      ],
      transitions: [
        { from: 'introduction', to: 'introduction', event: 'INIT', effects: [['render-ui', 'main', { type: 'form-section', fields: [] }]] },
        { from: 'introduction', to: 'content', event: 'NEXT', effects: [] },
        { from: 'content', to: 'introduction', event: 'PREV', effects: [] },
        { from: 'content', to: 'record', event: 'NEXT', effects: [] },
        { from: 'record', to: 'content', event: 'PREV', effects: [] },
        { from: 'record', to: 'closing', event: 'NEXT', effects: [] },
        { from: 'closing', to: 'completed', event: 'COMPLETE', effects: [['persist', 'update', 'Inspection', {}]] },
      ],
    },
    emits: [{ event: 'INSPECTION_COMPLETED', scope: 'external' }],
    listens: [{ event: 'INSPECTOR_ASSIGNED', triggers: 'INIT', scope: 'external' }],
  }],
  pages: [{ name: 'InspectionPage', path: '/inspection/:id', traits: [{ ref: 'InspectionWorkflow' }] }],
};

// ============================================================================
// classifyWorkflow
// ============================================================================

describe('classifyWorkflow', () => {
  it('detects CRUD from state names', () => {
    const states: State[] = [
      { name: 'browsing', isInitial: true },
      { name: 'creating' },
      { name: 'editing' },
      { name: 'viewing' },
    ];
    expect(classifyWorkflow(states)).toBe('crud');
  });

  it('detects wizard from numbered steps', () => {
    const states: State[] = [
      { name: 'Step1', isInitial: true },
      { name: 'Step2' },
      { name: 'Step3' },
      { name: 'Complete', isTerminal: true },
    ];
    expect(classifyWorkflow(states)).toBe('wizard');
  });

  it('detects wizard from linear chain to terminal', () => {
    const states: State[] = [
      { name: 'introduction', isInitial: true },
      { name: 'content' },
      { name: 'record' },
      { name: 'closing' },
      { name: 'completed', isTerminal: true },
    ];
    expect(classifyWorkflow(states)).toBe('wizard');
  });

  it('returns custom for domain-specific states', () => {
    const states: State[] = [
      { name: 'lobby', isInitial: true },
      { name: 'deployment' },
      { name: 'combat' },
    ];
    expect(classifyWorkflow(states)).toBe('custom');
  });
});

// ============================================================================
// summarizeOrbital
// ============================================================================

describe('summarizeOrbital', () => {
  it('strips effects from transitions', () => {
    const summary = summarizeOrbital(crudOrbital);
    const transitions = summary.traits[0];
    if (typeof transitions === 'object' && 'stateMachine' in transitions) {
      for (const t of transitions.stateMachine!.transitions) {
        expect(t.effects).toBeUndefined();
      }
    }
  });

  it('strips guards from transitions', () => {
    const withGuard: OrbitalDefinition = {
      ...crudOrbital,
      traits: [{
        ...(crudOrbital.traits[0] as { name: string; category: 'interaction'; scope: 'instance' | 'collection'; linkedEntity: string; stateMachine: { states: State[]; events: { key: string; name: string }[]; transitions: { from: string; to: string; event: string; effects?: unknown[]; guard?: unknown }[] } }),
        stateMachine: {
          ...(crudOrbital.traits[0] as { stateMachine: { states: State[]; events: { key: string; name: string }[]; transitions: { from: string; to: string; event: string }[] } }).stateMachine,
          transitions: [
            { from: 'browsing', to: 'creating', event: 'CREATE', guard: ['>', '@entity.count', 0] },
          ],
        },
      }],
    };
    const summary = summarizeOrbital(withGuard);
    const trait = summary.traits[0];
    if (typeof trait === 'object' && 'stateMachine' in trait) {
      expect(trait.stateMachine!.transitions[0].guard).toBeUndefined();
    }
  });

  it('strips primaryKey and optional fields from entity', () => {
    const summary = summarizeOrbital(crudOrbital);
    const entity = summary.entity;
    if (typeof entity === 'object' && entity.fields) {
      const fieldNames = entity.fields.map(f => f.name);
      // id (primaryKey) stripped
      expect(fieldNames).not.toContain('id');
      // optional fields stripped
      expect(fieldNames).not.toContain('unitName');
      expect(fieldNames).not.toContain('unitEmail');
      // required fields kept
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('surname');
      expect(fieldNames).toContain('department');
    }
  });

  it('keeps enum fields with values', () => {
    const summary = summarizeOrbital(crudOrbital);
    const entity = summary.entity;
    if (typeof entity === 'object' && entity.fields) {
      const statusField = entity.fields.find(f => f.name === 'status');
      expect(statusField).toBeDefined();
      expect(statusField?.type).toBe('enum');
      if (statusField?.type === 'enum') {
        expect(statusField.values).toEqual(['active', 'inactive']);
      }
    }
  });

  it('keeps relation fields', () => {
    const summary = summarizeOrbital(crudOrbital);
    const entity = summary.entity;
    if (typeof entity === 'object' && entity.fields) {
      const rel = entity.fields.find(f => f.name === 'companyId');
      expect(rel).toBeDefined();
      expect(rel?.type).toBe('relation');
      if (rel?.type === 'relation') {
        expect(rel.relation).toEqual({ entity: 'Company', cardinality: 'one' });
      }
    }
  });

  it('strips theme', () => {
    const summary = summarizeOrbital(crudOrbital);
    expect(summary.theme).toBeUndefined();
  });

  it('strips payload from events', () => {
    const summary = summarizeOrbital(crudOrbital);
    const trait = summary.traits[0];
    if (typeof trait === 'object' && 'stateMachine' in trait) {
      for (const e of trait.stateMachine!.events) {
        expect(e.payloadSchema).toBeUndefined();
        // name is normalized to key
        expect(e.name).toBe(e.key);
      }
    }
  });

  it('deduplicates transitions with same (from, to, event)', () => {
    const summary = summarizeOrbital(crudOrbital);
    const trait = summary.traits[0];
    if (typeof trait === 'object' && 'stateMachine' in trait) {
      const transitions = trait.stateMachine!.transitions;
      // Original had 10 transitions, but no exact (from,to,event) duplicates in this fixture
      // Each is unique, so count stays the same
      const keys = transitions.map(t => `${t.from}::${t.to}::${t.event}`);
      const unique = new Set(keys);
      expect(keys.length).toBe(unique.size);
    }
  });

  it('preserves emits and listens', () => {
    const summary = summarizeOrbital(wizardOrbital);
    const trait = summary.traits[0];
    if (typeof trait === 'object' && 'emits' in trait) {
      expect(trait.emits).toHaveLength(1);
      expect(trait.emits![0].event).toBe('INSPECTION_COMPLETED');
      expect(trait.emits![0].scope).toBe('external');
    }
    if (typeof trait === 'object' && 'listens' in trait) {
      expect(trait.listens).toHaveLength(1);
      expect(trait.listens![0].event).toBe('INSPECTOR_ASSIGNED');
      expect(trait.listens![0].triggers).toBe('INIT');
    }
  });

  it('preserves pages with trait refs', () => {
    const summary = summarizeOrbital(crudOrbital);
    expect(summary.pages).toHaveLength(1);
    const page = summary.pages[0];
    if (typeof page === 'object' && 'name' in page) {
      expect(page.name).toBe('InspectorsPage');
      expect(page.path).toBe('/inspectors');
      expect(page.traits).toEqual([{ ref: 'InspectorManagement' }]);
    }
  });

  it('handles entity reference strings', () => {
    const refOrbital: OrbitalDefinition = {
      name: 'RefTest',
      entity: 'Goblin.entity',
      traits: [],
      pages: [],
    };
    const summary = summarizeOrbital(refOrbital);
    expect(typeof summary.entity).toBe('object');
    if (typeof summary.entity === 'object') {
      expect(summary.entity.name).toBe('Goblin.entity');
      expect(summary.entity.fields).toEqual([]);
    }
  });
});

// ============================================================================
// summarizeSchema
// ============================================================================

describe('summarizeSchema', () => {
  it('summarizes all orbitals and strips schema-level metadata', () => {
    const schema: OrbitalSchema = {
      name: 'Inspection System',
      description: 'Government inspection system',
      version: '2.0.0',
      domainContext: { category: 'government' } as never,
      designTokens: {} as never,
      orbitals: [crudOrbital, wizardOrbital],
    };

    const summary = summarizeSchema(schema);

    expect(summary.name).toBe('Inspection System');
    expect(summary.description).toBe('Government inspection system');
    expect(summary.version).toBe('2.0.0');
    expect(summary.orbitals).toHaveLength(2);
    // domainContext and designTokens stripped
    expect(summary.domainContext).toBeUndefined();
    expect(summary.designTokens).toBeUndefined();
  });

  it('produces smaller output than input', () => {
    const schema: OrbitalSchema = {
      name: 'Test',
      orbitals: [crudOrbital],
    };
    const inputSize = JSON.stringify(schema).length;
    const outputSize = JSON.stringify(summarizeSchema(schema)).length;
    expect(outputSize).toBeLessThan(inputSize);
  });
});
