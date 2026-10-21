import axe from 'axe-core';
import type { Result } from 'axe-core';

/**
 * axe violations for a rendered subtree. `color-contrast` needs real layout
 * (checked by the live browser harness, not jsdom); `region` judges whole
 * pages, not a component in isolation.
 */
export async function axeViolations(node: Element): Promise<Result[]> {
  const results = await axe.run(node, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations;
}

/** One line per violation: rule id, impact and the failing selectors. */
export function describeViolations(violations: Result[]): string[] {
  return violations.map((v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
