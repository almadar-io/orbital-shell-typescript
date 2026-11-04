import React from "react";

function echoKey(value: string | number | readonly string[] | undefined): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");
}

export function useFieldDraft<T extends string | number | readonly string[] | undefined>(
  value: T,
  declarative: boolean,
): { displayValue: T; record: (next: T) => void } {
  const [draft, setDraft] = React.useState<T>(value);
  const pending = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!declarative) return;
    // G-CROSS-415: pending echoes acknowledge edits; external values replace the draft.
    const key = echoKey(value);
    if (pending.current.has(key)) {
      pending.current.delete(key);
      return;
    }
    pending.current.clear();
    setDraft(value);
  }, [value, declarative]);

  const record = React.useCallback((next: T) => {
    pending.current.add(echoKey(next));
    setDraft(next);
  }, []);

  return { displayValue: declarative ? draft : value, record };
}
