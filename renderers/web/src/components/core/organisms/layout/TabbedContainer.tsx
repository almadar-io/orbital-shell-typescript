'use client';
/**
 * TabbedContainer Component
 *
 * Tabbed content areas with shared header/context.
 * Wraps the Tabs molecule with layout-specific styling.
 *
 * Uses wireframe theme styling (high contrast, sharp edges).
 */
import React from "react";
import { Tabs, type TabItem } from "../../molecules/Tabs";
import type { A11yProps } from "@almadar/core";
import { cn } from '../../../../core';
import { domPassthrough } from '../../../../core';

export interface TabDefinition {
  /** Tab identifier */
  id: string;
  /** Tab label */
  label: string;
  /** Tab content (optional if using sectionId) */
  content?: React.ReactNode;
  /** Section ID to render (alternative to content) */
  sectionId?: string;
  /** Optional badge/count */
  badge?: string | number;
  /** Disable this tab */
  disabled?: boolean;
}

export interface TabbedContainerProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Tab definitions */
  tabs: TabDefinition[];
  /** Default active tab ID */
  defaultTab?: string;
  /** Controlled active tab */
  activeTab?: string;
  /** Callback when tab changes */
  onTabChange?: (tabId: string) => void;
  /** Tab position */
  position?: "top" | "left";
  /** Additional CSS classes */
  className?: string;
}

/**
 * TabbedContainer - Tabbed content areas
 */
export const TabbedContainer: React.FC<TabbedContainerProps> = ({
  tabs,
  defaultTab,
  activeTab: controlledActiveTab,
  onTabChange,
  position = "top",
  className,
  ...rest
}) => {
  const items: TabItem[] = (tabs ?? []).map((tab) => ({
    id: tab.id,
    label: tab.label,
    badge: tab.badge,
    disabled: tab.disabled,
    content: tab.content ?? null,
  }));

  return (
    <Tabs
      {...domPassthrough(rest)}
      items={items}
      defaultActiveTab={defaultTab}
      activeTab={controlledActiveTab}
      onTabChange={onTabChange}
      orientation={position === "left" ? "vertical" : "horizontal"}
      className={cn("h-full", className)}
    />
  );
};

TabbedContainer.displayName = "TabbedContainer";

export default TabbedContainer;
