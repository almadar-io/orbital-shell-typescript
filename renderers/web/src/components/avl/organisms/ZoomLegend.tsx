'use client';

/**
 * ZoomLegend — Collapsible HTML overlay showing AVL primitives
 * relevant to the current zoom band.
 */

import React, { useState } from 'react';
import { useTranslate } from '../../../core';
import { type ZoomBand } from '../../../lib/avl-zoom-band';

export interface ZoomLegendProps {
  band: ZoomBand;
}

interface LegendItem {
  icon: string;
  labelKey?: string;
  code?: string;
  tint?: string;
}

const BAND_LEGENDS: Record<ZoomBand, LegendItem[]> = {
  system: [
    { icon: '\u25C9', labelKey: 'avl.glyph.entity' },
    { icon: '\u25CF\u25B2\u25A0\u25C6', labelKey: 'zoomLegend.fieldTypes' },
    { icon: '\u25CF\u2501\u25CF', labelKey: 'zoomLegend.stateChain' },
    { icon: '\u25A0', labelKey: 'avl.glyph.page' },
    { icon: '\u2500 \u2500', labelKey: 'zoomLegend.eventWire' },
  ],
  module: [
    { icon: '\u25C9', labelKey: 'avl.glyph.entity' },
    { icon: '\u26C1', labelKey: 'avl.glyph.persistence' },
    { icon: '\u25CF\u25B2\u25A0\u25C6\u25CB\u2B21\u2261', labelKey: 'zoomLegend.fieldTypes' },
    { icon: '\u2501\u25CF\u2501', labelKey: 'zoomLegend.stateMachine' },
    { icon: '\u229E\u270E\u26C1\uD83D\uDCE1', labelKey: 'avl.effects' },
    { icon: '\u25A0', labelKey: 'avl.glyph.page' },
    { icon: '\u25C0\u301C\u301C / \u301C\u301C\u25B6', labelKey: 'zoomLegend.emitListen' },
  ],
  behavior: [
    { icon: '\u25CF', tint: 'var(--color-success)', labelKey: 'avlLegend.initialState' },
    { icon: '\u25CF', tint: 'var(--color-error)', labelKey: 'zoomLegend.terminalState' },
    { icon: '\u25CF', tint: 'var(--color-info)', labelKey: 'zoomLegend.hubState' },
    { icon: '\u26A1', labelKey: 'avl.glyph.event' },
    { icon: '\u25C7', labelKey: 'avl.glyph.guard' },
    { icon: '\u229E\u270E\u26C1\uD83D\uDCE1\uD83D\uDD14', labelKey: 'avl.effects' },
    { icon: '\u2500 \u2500', tint: 'var(--color-warning)', labelKey: 'zoomLegend.emitListen' },
  ],
  detail: [
    { icon: '\u26A1', labelKey: 'zoomLegend.triggerEvent' },
    { icon: '\u25C7', labelKey: 'zoomLegend.guardDiamond' },
    { icon: '\u229E', code: 'render-ui' },
    { icon: '\u270E', code: 'set' },
    { icon: '\u26C1', code: 'persist' },
    { icon: '\uD83D\uDCE1', code: 'emit' },
    { icon: '@', labelKey: 'avl.glyph.binding' },
    { icon: '\u25CF\u25B2\u25A0', labelKey: 'zoomLegend.fieldTypes' },
  ],
};

export const ZoomLegend: React.FC<ZoomLegendProps> = ({ band }) => {
  const { t } = useTranslate();
  const [collapsed, setCollapsed] = useState(true);
  const items = BAND_LEGENDS[band];

  return (
    <div className="absolute bottom-2 left-2 z-10">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="px-2 py-1 text-xs rounded-md bg-card/90 border border-border text-muted-foreground backdrop-blur-sm cursor-pointer hover:bg-card"
      >
        {collapsed ? t('zoomLegend.legend') : t('zoomLegend.hide')}
      </button>
      {!collapsed && (
        <div className="mt-1 px-2 py-1.5 rounded-md bg-card/95 border border-border backdrop-blur-sm space-y-0.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="opacity-70 w-6 text-center" style={item.tint ? { color: item.tint } : undefined}>{item.icon}</span>
              <span>{item.labelKey ? t(item.labelKey) : item.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

ZoomLegend.displayName = 'ZoomLegend';
