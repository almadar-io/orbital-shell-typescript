/**
 * KnobSettingRow — one knob of a call site, edited with its questionnaire field and set on the
 * call site through the knob's own question (core `answerToMutations` →
 * `UI:TRAIT_CONFIG_CHANGE`). A click-to-choose knob commits at once; a typed one when its
 * field loses focus. The inspector's Settings list and the studio's knob search share it.
 */
import React, { useCallback, useState } from 'react';
import type { DomainQuestionAnswer, DomainQuestionInputType } from '@almadar/core';
import { answerToMutations } from '@almadar/core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { KnobField } from './KnobField';
import type { ElementKnob } from '../../../lib/element-edit-access';
import { useEventBus } from '../../../core';

const COMMIT_ON_CHANGE: ReadonlySet<DomainQuestionInputType> = new Set(['boolean', 'enum', 'persistence', 'multiselect']);

export interface KnobSettingRowProps {
  knob: ElementKnob;
  editable: boolean;
}

export function KnobSettingRow({ knob, editable }: KnobSettingRowProps): React.ReactElement {
  const eventBus = useEventBus();
  const [draft, setDraft] = useState<DomainQuestionAnswer | undefined>(knob.value);
  const [dirty, setDirty] = useState(false);
  const commit = useCallback((value: DomainQuestionAnswer) => {
    // The knob's own question says which call site it sets (core's reducer, as the questionnaire).
    for (const m of answerToMutations(knob.question.mutationTemplate, value, knob.question)) {
      if (m.kind !== 'set-trait-override-config') continue;
      eventBus.emit('UI:TRAIT_CONFIG_CHANGE', { orbitalName: m.orbitalName, traitName: m.traitName, key: m.key, valueJson: JSON.stringify(m.value) });
    }
  }, [eventBus, knob.question]);
  const handleChange = useCallback((next: DomainQuestionAnswer) => {
    setDraft(next);
    if (COMMIT_ON_CHANGE.has(knob.question.inputType)) {
      commit(next);
      return;
    }
    setDirty(true);
  }, [knob.question.inputType, commit]);
  const handleBlur = useCallback(() => {
    if (!dirty || draft === undefined) return;
    setDirty(false);
    commit(draft);
  }, [dirty, draft, commit]);
  return (
    <Box className="flex flex-col gap-1" onBlur={handleBlur}>
      <Typography variant="small" className="text-xs">{knob.question.question}</Typography>
      {knob.question.helpText ? (
        <Typography variant="caption" className="text-muted-foreground text-[10px]">{knob.question.helpText}</Typography>
      ) : null}
      {editable ? (
        <KnobField question={knob.question} value={draft} onChange={handleChange} />
      ) : (
        <Typography variant="small" className="text-xs text-muted-foreground">
          {draft === undefined || draft === null ? '—' : typeof draft === 'object' ? JSON.stringify(draft) : String(draft)}
        </Typography>
      )}
    </Box>
  );
}

KnobSettingRow.displayName = 'KnobSettingRow';
