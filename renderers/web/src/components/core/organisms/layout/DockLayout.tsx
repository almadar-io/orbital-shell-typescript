'use client';
/**
 * DockLayout Component
 *
 * Lean multi-region app frame: far-left rail, collapsible/resizable sidebar,
 * required main, collapsible/resizable bottom panel, slim status bar, and a
 * collapsible right secondary sidebar. Resizable boundaries are delegated to
 * SplitPane (same directory) — DockLayout owns no drag/resize math itself.
 *
 * sidebarWidth/bottomPanelHeight are SplitPane ratio values (0-100), not
 * pixels: they pass straight through to SplitPane's `ratio` contract so the
 * boundary math stays owned by SplitPane.
 *
 * Every collapsible region (sidebar, secondary sidebar, bottom panel) has the
 * same control: a gutter beside it holding one IconButton that collapses it,
 * and — collapsed — expands it again. Controlled when the host passes
 * `*Collapsed`, uncontrolled otherwise.
 *
 * Compact (narrower than 1024px — phones and tablets, or `compact`): the
 * studio's mobile variant. `main` fills the screen; a top bar opens the rest
 * as drawers — ☰ the rail's items (then the picked item's `sidebar` panel),
 * and buttons for `secondarySidebar` and `bottomPanel`. A rail reads
 * `useDockLayout()` to render itself as menu rows and to show its panel.
 */
import React, { createContext, useContext, useState } from "react";
import { Box } from '../../../../core';
import { HStack, VStack } from '../../../../core';
import type { A11yProps } from "@almadar/core";
import { cn } from '../../../../core';
import { domPassthrough, type DomPassthrough } from '../../../../core';
import { SplitPane } from "./SplitPane";
import { IconButton } from "../../molecules/IconButton";
import { useTranslate } from '../../../../core';
import { useMediaQuery } from '../../../../core';
import { Drawer } from "../../molecules/Drawer";
import type { IconInput } from '../../../../core';

export interface DockLayoutContextValue {
  /** The mobile variant: the rail is a menu in a drawer, not a column. */
  compact: boolean;
  /** Compact: switch the left drawer from the menu to the picked item's panel. */
  showPanel: () => void;
  /** Compact: close the menu (an item that opens no panel, e.g. a dialog). */
  closeMenu: () => void;
  /** Compact: open the right panel's drawer from inside `main`. Desktop: no-op — the host owns that panel. */
  showSecondary: () => void;
}

const DockLayoutContext = createContext<DockLayoutContextValue>({ compact: false, showPanel: () => undefined, closeMenu: () => undefined, showSecondary: () => undefined });

/** How a rail inside a DockLayout should render (a column, or compact menu rows) and how it opens its panel. */
export function useDockLayout(): DockLayoutContextValue {
  return useContext(DockLayoutContext);
}

/** The studio's compact (mobile) variant applies below this width — phones and tablets. */
export const COMPACT_MEDIA_QUERY = "(max-width: 1023.98px)";

/** Whether the viewport is in the compact (mobile) range — the one threshold every compact decision uses. */
export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_MEDIA_QUERY);
}
const DESKTOP_CONTEXT: DockLayoutContextValue = { compact: false, showPanel: () => undefined, closeMenu: () => undefined, showSecondary: () => undefined };

type Region = "sidebar" | "secondary-sidebar" | "bottom-panel";

/** Collapsed state for one region: the host's when it passes one, local otherwise. */
function useCollapsed(controlled: boolean | undefined, onChange: ((collapsed: boolean) => void) | undefined): [boolean, (next: boolean) => void] {
  const [local, setLocal] = useState(false);
  const collapsed = controlled ?? local;
  const set = (next: boolean) => {
    onChange?.(next);
    if (controlled === undefined) setLocal(next);
  };
  return [collapsed, set];
}

const TOGGLE_ICONS: Record<Region, { open: string; closed: string; position: "left" | "right" | "top" }> = {
  sidebar: { open: "panel-left-close", closed: "panel-left-open", position: "right" },
  "secondary-sidebar": { open: "panel-right-close", closed: "panel-right-open", position: "left" },
  "bottom-panel": { open: "panel-bottom-close", closed: "panel-bottom-open", position: "top" },
};

const PanelToggle: React.FC<{ region: Region; collapsed: boolean; onToggle: () => void }> = ({ region, collapsed, onToggle }) => {
  const { t } = useTranslate();
  const icons = TOGGLE_ICONS[region];
  return (
    <IconButton
      icon={collapsed ? icons.closed : icons.open}
      label={t(collapsed ? `dockLayout.expand.${region}` : `dockLayout.collapse.${region}`)}
      tooltipPosition={icons.position}
      aria-expanded={!collapsed}
      data-testid={`dock-collapse-${region}`}
      className="w-7 h-7"
      onClick={onToggle}
    />
  );
};

export interface DockLayoutProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Fixed-width far-left vertical strip (e.g. an icon nav rail). */
  rail?: React.ReactNode;
  /** Collapsible, resizable left sidebar. */
  sidebar?: React.ReactNode;
  /** Required center region. */
  main: React.ReactNode;
  /** Collapsible, resizable-height bottom panel. */
  bottomPanel?: React.ReactNode;
  /** Slim strip pinned to the bottom of the frame, below the bottom panel. */
  statusBar?: React.ReactNode;
  /** Collapsible right sidebar. */
  secondarySidebar?: React.ReactNode;

  /** Width of `rail` in pixels; the rail sizes the column itself when omitted. */
  railWidth?: number;
  /** Width of `secondarySidebar` in pixels (fixed — not resizable). @default 280 */
  secondarySidebarWidth?: number;

  /** Whether `sidebar` is collapsed (controlled; the layout keeps its own state when omitted). */
  sidebarCollapsed?: boolean;
  /** @notification */
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /** Sidebar size as a SplitPane ratio (0-100, percentage of the sidebar/main split). @default 20 */
  sidebarWidth?: number;
  /** @notification */
  onSidebarWidthChange?: (width: number) => void;
  /** Minimum sidebar size in pixels, forwarded to SplitPane's `minSize`. @default 160 */
  sidebarMinSize?: number;

  /** Whether `bottomPanel` is collapsed (controlled; the layout keeps its own state when omitted). */
  bottomPanelCollapsed?: boolean;
  /** @notification */
  onBottomPanelCollapsedChange?: (collapsed: boolean) => void;
  /** Bottom panel size as a SplitPane ratio (0-100, percentage given to the panel). @default 30 */
  bottomPanelHeight?: number;
  /** @notification */
  onBottomPanelHeightChange?: (height: number) => void;
  /** Minimum bottom panel size in pixels, forwarded to SplitPane's `minSize`. @default 120 */
  bottomPanelMinSize?: number;

  /** Whether `secondarySidebar` is collapsed (controlled; the layout keeps its own state when omitted). */
  secondarySidebarCollapsed?: boolean;
  /** @notification */
  onSecondarySidebarCollapsedChange?: (collapsed: boolean) => void;

  /** The mobile variant; decided by the viewport (narrower than 1024px) when omitted. */
  compact?: boolean;
  /** Compact: the top-bar button that opens `secondarySidebar` (e.g. "Inspector", "Chat"). */
  secondarySidebarLabel?: string;
  secondarySidebarIcon?: IconInput;
  /** Compact: the top-bar button that opens `bottomPanel`. */
  bottomPanelLabel?: string;
  bottomPanelIcon?: IconInput;
  /** Compact: the host's own actions at the end of the top bar (e.g. Run). */
  topBarActions?: React.ReactNode;

  /** Additional CSS classes on the root frame. */
  className?: string;
  railClassName?: string;
  sidebarClassName?: string;
  mainClassName?: string;
  bottomPanelClassName?: string;
  statusBarClassName?: string;
  secondarySidebarClassName?: string;
}

/**
 * DockLayout - multi-region app frame (rail + sidebar + main + bottom panel
 * + status bar + secondary sidebar), composed from SplitPane for the two
 * resizable boundaries.
 */
export const DockLayout: React.FC<DockLayoutProps> = ({
  rail,
  sidebar,
  main,
  bottomPanel,
  statusBar,
  secondarySidebar,
  railWidth,
  secondarySidebarWidth,
  sidebarCollapsed: sidebarCollapsedProp,
  onSidebarCollapsedChange,
  sidebarWidth,
  onSidebarWidthChange,
  sidebarMinSize,
  bottomPanelCollapsed: bottomPanelCollapsedProp,
  onBottomPanelCollapsedChange,
  bottomPanelHeight,
  onBottomPanelHeightChange,
  bottomPanelMinSize,
  secondarySidebarCollapsed: secondarySidebarCollapsedProp,
  onSecondarySidebarCollapsedChange,
  compact: compactProp,
  secondarySidebarLabel,
  secondarySidebarIcon,
  bottomPanelLabel,
  bottomPanelIcon,
  topBarActions,
  className,
  railClassName,
  sidebarClassName,
  mainClassName,
  bottomPanelClassName,
  statusBarClassName,
  secondarySidebarClassName,
  ...rest
}) => {
  const a11y = domPassthrough(rest);
  const narrow = useCompactLayout();
  const compact = compactProp ?? narrow;
  if (compact) {
    return (
      <CompactDock
        rail={rail}
        sidebar={sidebar}
        main={main}
        bottomPanel={bottomPanel}
        statusBar={statusBar}
        secondarySidebar={secondarySidebar}
        secondarySidebarLabel={secondarySidebarLabel}
        secondarySidebarIcon={secondarySidebarIcon}
        bottomPanelLabel={bottomPanelLabel}
        bottomPanelIcon={bottomPanelIcon}
        topBarActions={topBarActions}
        className={className}
        mainClassName={mainClassName}
        statusBarClassName={statusBarClassName}
        a11y={a11y}
      />
    );
  }
  return (
    <DesktopDock
      {...{ rail, sidebar, main, bottomPanel, statusBar, secondarySidebar, railWidth, secondarySidebarWidth,
        sidebarCollapsedProp, onSidebarCollapsedChange, sidebarWidth, onSidebarWidthChange, sidebarMinSize,
        bottomPanelCollapsedProp, onBottomPanelCollapsedChange, bottomPanelHeight, onBottomPanelHeightChange, bottomPanelMinSize,
        secondarySidebarCollapsedProp, onSecondarySidebarCollapsedChange,
        className, railClassName, sidebarClassName, mainClassName, bottomPanelClassName, statusBarClassName, secondarySidebarClassName, a11y }}
    />
  );
};

type CompactDockProps = Pick<DockLayoutProps, "rail" | "sidebar" | "main" | "bottomPanel" | "statusBar" | "secondarySidebar"
  | "secondarySidebarLabel" | "secondarySidebarIcon" | "bottomPanelLabel" | "bottomPanelIcon" | "topBarActions" | "className" | "mainClassName" | "statusBarClassName"> & { a11y?: DomPassthrough };

const CompactDock: React.FC<CompactDockProps> = ({
  rail, sidebar, main, bottomPanel, statusBar, secondarySidebar,
  secondarySidebarLabel, secondarySidebarIcon, bottomPanelLabel, bottomPanelIcon, topBarActions,
  className, mainClassName, statusBarClassName, a11y,
}) => {
  const { t } = useTranslate();
  const [open, setOpen] = useState<"left" | "secondary" | "bottom" | null>(null);
  const [leftView, setLeftView] = useState<"menu" | "panel">("menu");
  const context: DockLayoutContextValue = {
    compact: true,
    showPanel: () => setLeftView("panel"),
    closeMenu: () => setOpen(null),
    showSecondary: () => { if (secondarySidebar) setOpen("secondary"); },
  };
  const openLeft = () => { setLeftView(rail ? "menu" : "panel"); setOpen("left"); };
  const close = () => setOpen(null);
  const leftContent = leftView === "menu" && rail ? rail : (
    <VStack gap="none" className="h-full min-h-0">
      {rail && (
        <HStack gap="xs" className="flex-shrink-0 items-center px-2 py-1 border-b border-border">
          <IconButton icon="arrow-left" label={t("dockLayout.backToMenu")} tooltipPosition="bottom" data-testid="dock-drawer-back" className="w-10 h-10" onClick={() => setLeftView("menu")} />
        </HStack>
      )}
      <Box className="flex-1 min-h-0 overflow-auto">{sidebar}</Box>
    </VStack>
  );

  return (
    <DockLayoutContext.Provider value={context}>
      <VStack gap="none" {...a11y} className={cn("w-full h-full overflow-hidden", className)}>
        {(rail || sidebar || secondarySidebar || bottomPanel || topBarActions) && (
          <Box className="flex flex-shrink-0 items-center gap-1 px-2 py-1 border-b border-border bg-surface" data-testid="dock-top-bar">
            {(rail || sidebar) && (
              <IconButton icon="menu" label={t("dockLayout.openMenu")} tooltipPosition="bottom" data-testid="dock-menu" className="w-10 h-10" onClick={openLeft} />
            )}
            <Box className="flex-1" />
            {bottomPanel && (
              <IconButton icon={bottomPanelIcon ?? "panel-bottom-open"} label={bottomPanelLabel ?? t("dockLayout.expand.bottom-panel")} tooltipPosition="bottom" data-testid="dock-open-bottom-panel" className="w-10 h-10" onClick={() => setOpen("bottom")} />
            )}
            {secondarySidebar && (
              <IconButton icon={secondarySidebarIcon ?? "panel-right-open"} label={secondarySidebarLabel ?? t("dockLayout.expand.secondary-sidebar")} tooltipPosition="bottom" data-testid="dock-open-secondary-sidebar" className="w-10 h-10" onClick={() => setOpen("secondary")} />
            )}
            {topBarActions}
          </Box>
        )}
        <Box className={cn("flex-1 min-h-0 min-w-0 overflow-auto", mainClassName)}>{main}</Box>
        {statusBar && (
          <Box className={cn("flex-shrink-0 border-t border-border bg-background", statusBarClassName)}>{statusBar}</Box>
        )}
        {(rail || sidebar) && (
          <Drawer isOpen={open === "left"} onClose={close} position="left" width="md" title={t("dockLayout.menu")}>
            {open === "left" ? leftContent : null}
          </Drawer>
        )}
        {secondarySidebar && (
          <Drawer isOpen={open === "secondary"} onClose={close} position="right" width="md" title={secondarySidebarLabel ?? t("dockLayout.expand.secondary-sidebar")}>
            {open === "secondary" ? secondarySidebar : null}
          </Drawer>
        )}
        {bottomPanel && (
          <Drawer isOpen={open === "bottom"} onClose={close} position="right" width="md" title={bottomPanelLabel ?? t("dockLayout.expand.bottom-panel")}>
            {open === "bottom" ? bottomPanel : null}
          </Drawer>
        )}
      </VStack>
    </DockLayoutContext.Provider>
  );
};

interface DesktopDockProps extends Omit<DockLayoutProps, "sidebarCollapsed" | "bottomPanelCollapsed" | "secondarySidebarCollapsed" | "compact"> {
  sidebarCollapsedProp?: boolean;
  bottomPanelCollapsedProp?: boolean;
  secondarySidebarCollapsedProp?: boolean;
  a11y?: DomPassthrough;
}

const DesktopDock: React.FC<DesktopDockProps> = ({
  rail, sidebar, main, bottomPanel, statusBar, secondarySidebar,
  railWidth, secondarySidebarWidth = 280,
  sidebarCollapsedProp, onSidebarCollapsedChange, sidebarWidth = 20, onSidebarWidthChange, sidebarMinSize = 160,
  bottomPanelCollapsedProp, onBottomPanelCollapsedChange, bottomPanelHeight = 30, onBottomPanelHeightChange, bottomPanelMinSize = 120,
  secondarySidebarCollapsedProp, onSecondarySidebarCollapsedChange,
  className, railClassName, sidebarClassName, mainClassName, bottomPanelClassName, statusBarClassName, secondarySidebarClassName, a11y,
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useCollapsed(sidebarCollapsedProp, onSidebarCollapsedChange);
  const [bottomPanelCollapsed, setBottomPanelCollapsed] = useCollapsed(bottomPanelCollapsedProp, onBottomPanelCollapsedChange);
  const [secondarySidebarCollapsed, setSecondarySidebarCollapsed] = useCollapsed(secondarySidebarCollapsedProp, onSecondarySidebarCollapsedChange);
  const showSidebar = Boolean(sidebar) && !sidebarCollapsed;
  const showBottomPanel = Boolean(bottomPanel) && !bottomPanelCollapsed;
  const showSecondarySidebar = Boolean(secondarySidebar) && !secondarySidebarCollapsed;

  const sideGutter = (region: Region, collapsed: boolean, toggle: () => void, edge: "l" | "r") => (
    <Box className={cn("flex-shrink-0 w-8 flex flex-col items-center pt-1 bg-surface", edge === "l" ? "border-l border-border" : "border-r border-border")}>
      <PanelToggle region={region} collapsed={collapsed} onToggle={toggle} />
    </Box>
  );

  const centerRow = (
    <HStack gap="none" className="flex-1 min-h-0 min-w-0">
      {/* No `h-full` on flex-grown children: height:100% resolves against
          centerRow's non-definite (flex-grown) height and collapses to
          content height — `min-h-0` + the HStack's items-stretch size it. */}
      <Box className={cn("flex-1 min-w-0 min-h-0 overflow-auto", mainClassName)}>
        {main}
      </Box>
      {secondarySidebar && sideGutter("secondary-sidebar", secondarySidebarCollapsed, () => setSecondarySidebarCollapsed(!secondarySidebarCollapsed), "l")}
      {showSecondarySidebar && (
        <Box
          className={cn(
            "flex-shrink-0 h-full overflow-auto border-l border-border",
            secondarySidebarClassName,
          )}
          style={{ width: secondarySidebarWidth }}
        >
          {secondarySidebar}
        </Box>
      )}
    </HStack>
  );

  const sidebarAndCenter = showSidebar ? (
    <SplitPane
      direction="horizontal"
      ratio={sidebarWidth}
      onRatioChange={onSidebarWidthChange}
      minSize={sidebarMinSize}
      resizable
      left={<Box className={cn("h-full overflow-auto", sidebarClassName)}>{sidebar}</Box>}
      right={<HStack gap="none" className="h-full min-w-0">{sideGutter("sidebar", false, () => setSidebarCollapsed(true), "r")}{centerRow}</HStack>}
      className="flex-1 min-h-0 min-w-0"
    />
  ) : sidebar ? (
    <HStack gap="none" className="flex-1 min-h-0 min-w-0">
      {sideGutter("sidebar", true, () => setSidebarCollapsed(false), "r")}
      {centerRow}
    </HStack>
  ) : (
    centerRow
  );

  const bottomGutter = bottomPanel ? (
    <HStack gap="none" className="flex-shrink-0 h-8 items-center justify-end px-1 border-t border-border bg-surface">
      <PanelToggle region="bottom-panel" collapsed={bottomPanelCollapsed} onToggle={() => setBottomPanelCollapsed(!bottomPanelCollapsed)} />
    </HStack>
  ) : null;

  const body = (
    <HStack gap="none" className="flex-1 min-h-0 min-w-0">
      {rail && (
        <Box
          className={cn(
            "flex-shrink-0 min-h-0 overflow-y-auto overflow-x-hidden border-r border-border",
            railClassName,
          )}
          style={{ width: railWidth }}
        >
          {rail}
        </Box>
      )}
      {sidebarAndCenter}
    </HStack>
  );

  const bodyPlusBottom = showBottomPanel ? (
    <SplitPane
      direction="vertical"
      ratio={100 - bottomPanelHeight}
      onRatioChange={(topRatio) => onBottomPanelHeightChange?.(100 - topRatio)}
      minSize={bottomPanelMinSize}
      resizable
      left={body}
      right={
        <VStack gap="none" className="h-full">
          {bottomGutter}
          <Box
            className={cn(
              "flex-1 min-h-0 overflow-auto",
              bottomPanelClassName,
            )}
          >
            {bottomPanel}
          </Box>
        </VStack>
      }
      className="flex-1 min-h-0"
    />
  ) : bottomPanel ? (
    <VStack gap="none" className="flex-1 min-h-0">
      {body}
      {bottomGutter}
    </VStack>
  ) : (
    body
  );

  return (
    <DockLayoutContext.Provider value={DESKTOP_CONTEXT}>
    <VStack gap="none" {...a11y} className={cn("w-full h-full overflow-hidden", className)}>
      {bodyPlusBottom}
      {statusBar && (
        <Box
          className={cn(
            "flex-shrink-0 border-t border-border bg-background",
            statusBarClassName,
          )}
        >
          {statusBar}
        </Box>
      )}
    </VStack>
    </DockLayoutContext.Provider>
  );
};

DockLayout.displayName = "DockLayout";

export default DockLayout;
