// @vitest-environment jsdom
/**
 * The renderer paints `fields` exactly as the program gives them. Field
 * definitions are stamped by the resolver (R27); a bare-name field is not
 * enriched from the entity schema at render time.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import { EntitySchemaProvider } from '../../src/providers/EntitySchemaContext';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';

const TRAIT = 'TaskForm';
function ManagerGrabber({ onReady }: { onReady: (manager: UISlotManager) => void }): null {
  onReady(useUISlots());
  return null;
}

function renderForm(fields: ReadonlyArray<string | { name: string; label: string; type: string; values?: string[] }>) {
  let manager!: UISlotManager;
  const view = render(
    <EventBusProvider isolated>
      <EntitySchemaProvider orbitalsByTrait={new Map([[TRAIT, 'TaskOrbital']])}>
        <UISlotProvider>
          <ManagerGrabber onReady={(m) => { manager = m; }} />
          <UISlotComponent slot="main" />
        </UISlotProvider>
      </EntitySchemaProvider>
    </EventBusProvider>,
  );
  act(() => {
    manager.render({ target: 'main', pattern: 'form-section', sourceTrait: TRAIT, props: { fields: [...fields] } });
  });
  return view;
}

describe('UISlotRenderer — no render-time field enrichment', () => {
  it('a bare-name field renders as given: no select from the entity enum', () => {
    const { container } = renderForm(['status']);
    expect(container.querySelector('form, input, textarea')).not.toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[role="combobox"]')).toBeNull();
  });

  it('control: a resolver-stamped field with values renders its select', () => {
    const { container } = renderForm([{ name: 'status', label: 'status', type: 'string', values: ['open', 'done'] }]);
    expect(container.querySelector('select, [role="combobox"]')).not.toBeNull();
  });
});
