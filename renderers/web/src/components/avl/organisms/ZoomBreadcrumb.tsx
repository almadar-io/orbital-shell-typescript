'use client';

/**
 * ZoomBreadcrumb — HTML overlay showing current zoom band context.
 *
 * Positioned absolute top-left of the FlowCanvas.
 * Shows AVL primitive icons inline with breadcrumb segments.
 */

import React from 'react';
import { useTranslate } from '../../../core';
import { type ZoomBand } from '../../../lib/avl-zoom-band';

export interface ZoomBreadcrumbProps {
  band: ZoomBand;
  applicationName?: string;
  orbitalName?: string;
  traitName?: string;
  eventName?: string;
}

const BAND_LABEL_KEYS: Record<ZoomBand, string> = {
  system: 'zoomBreadcrumb.system',
  module: 'zoomBreadcrumb.module',
  behavior: 'zoomBreadcrumb.behavior',
  detail: 'zoomBreadcrumb.detail',
};

const BAND_ICONS: Record<ZoomBand, string> = {
  system: '\u25C9',   // ◉ filled circle
  module: '\u25C9',   // ◉ filled circle
  behavior: '\u25CE', // ◎ double circle
  detail: '\u26A1',   // ⚡ lightning
};

export const ZoomBreadcrumb: React.FC<ZoomBreadcrumbProps> = ({
  band,
  applicationName,
  orbitalName,
  traitName,
  eventName,
}) => {
  const { t } = useTranslate();
  const segments: Array<{ icon: string; label: string }> = [];

  if (applicationName) {
    segments.push({ icon: '\u25C9', label: applicationName });
  }

  segments.push({ icon: BAND_ICONS[band], label: t(BAND_LABEL_KEYS[band]) });

  if (orbitalName && (band === 'module' || band === 'behavior' || band === 'detail')) {
    segments.push({ icon: '\u25C9', label: orbitalName });
  }
  if (traitName && (band === 'behavior' || band === 'detail')) {
    segments.push({ icon: '\u25CE', label: traitName });
  }
  if (eventName && band === 'detail') {
    segments.push({ icon: '\u26A1', label: eventName });
  }

  return (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 rounded-md bg-card/90 border border-border text-xs text-muted-foreground backdrop-blur-sm">
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="opacity-40">{'>'}</span>}
          <span className="opacity-60">{seg.icon}</span>
          <span>{seg.label}</span>
        </React.Fragment>
      ))}
    </div>
  );
};

ZoomBreadcrumb.displayName = 'ZoomBreadcrumb';
