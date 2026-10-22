import { RuntimeValue, PageFactField, BrowserPageFacts } from '@almadar/core';

/**
 * `browser/page-facts`: the closed fact set, the argument check, and the page reader the client handler uses.
 */

/** The fields a `browser/page-facts` call asks for, or why the call is refused before anything is read. */
declare function parsePageFactFields(value: RuntimeValue | undefined): {
    fields: PageFactField[];
} | {
    error: string;
};
/** Read `fields` from the page in list order. No window or document is `available: false`; a throwing getter rejects. */
declare function readPageFacts(fields: readonly PageFactField[]): BrowserPageFacts;

export { parsePageFactFields, readPageFacts };
