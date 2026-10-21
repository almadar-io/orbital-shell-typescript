/**
 * MasterDetail Component
 *
 * Classic master-detail pattern with a list on the left
 * and selected item detail on the right.
 *
 * Uses wireframe theme styling (high contrast, sharp edges).
 */
import React from "react";
import type { A11yProps } from "@almadar/core";
import { cn } from '../../../../core';
import { domPassthrough } from '../../../../core';
import { Typography } from '../../../../core';
import { SplitPane } from "./SplitPane";
import { useTranslate } from '../../../../core';
import { Box } from '../../../../core';

export interface MasterDetailLayoutProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Master panel content (usually a list) */
  master: React.ReactNode;
  /** Detail panel content */
  detail: React.ReactNode;
  /** Content shown when nothing is selected */
  emptyDetail?: React.ReactNode;
  /** Whether an item is currently selected */
  hasSelection?: boolean;
  /** Width of master panel (e.g., '350px', '30%') */
  masterWidth?: string;
  /** Additional CSS classes */
  className?: string;
  /** Class for master pane */
  masterClassName?: string;
  /** Class for detail pane */
  detailClassName?: string;
}

/**
 * Default empty state for detail panel
 */
const DefaultEmptyDetail: React.FC = () => {
  const { t } = useTranslate();
  return (
    <div className="flex items-center justify-center h-full border-heavy border-dashed border-border">
      <Typography
        variant="body2"
        className="text-muted-foreground"
      >
        {t('masterDetail.selectItem')}
      </Typography>
    </div>
  );
};

/**
 * MasterDetail - List + detail split layout
 */
export const MasterDetailLayout: React.FC<MasterDetailLayoutProps> = ({
  master,
  detail,
  emptyDetail,
  hasSelection = false,
  masterWidth = "350px",
  className,
  masterClassName,
  detailClassName,
  ...rest
}) => {
  // Below a `@md` container a two-column split has no room (a fixed master track leaves the
  // detail a ~0px sliver on phones — opening a record looked like a dead
  // click). Small screens get the standard two-screen flow instead: the list,
  // or the open record full-width; the record's close action returns to the
  // list. The grid only exists from a `@md` container up, via a CSS var so masterWidth
  // stays a prop.
  return (
    <Box {...domPassthrough(rest)} className={cn("@container w-full h-full", className)}>
      <Box
        className="w-full h-full @md:grid @md:grid-cols-[var(--master-detail-cols)]"
        style={{ "--master-detail-cols": `${masterWidth} 1fr` } as React.CSSProperties}
      >
        <Box
          className={cn(
            "border-e border-border overflow-auto",
            hasSelection && "hidden @md:block",
            masterClassName,
          )}
        >
          {master}
        </Box>

        <Box className={cn("overflow-auto", !hasSelection && "hidden @md:block", detailClassName)}>
          {hasSelection ? detail : emptyDetail || <DefaultEmptyDetail />}
        </Box>
      </Box>
    </Box>
  );
};

MasterDetailLayout.displayName = "MasterDetailLayout";

export default MasterDetailLayout;
