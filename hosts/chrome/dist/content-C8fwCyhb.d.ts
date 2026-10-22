import { JsonValue } from '@almadar/core';
import { TabField, TabApply, TabAction, TabFailureKind, TabCommand } from '@almadar/core/kernel-wire';

/**
 * The content-script half of the browser-tab port: a generic executor over one document. Elements are addressed by
 * ids it issues. It performs the raw commands the kernel sends (read, watch, style, interact) and decides nothing:
 * which styles a treatment comes to, which fields to read and which interactions exist are the kernel's. It never
 * evaluates code and knows no site.
 */

/** One element the page reports: the id this executor issued and the fields read from it. */
type TabElement = {
    elementId: string;
    fields: Record<string, string>;
};
/** A command the page could not perform, with the kernel's closed reason. */
declare class PageCommandError extends Error {
    readonly kind: TabFailureKind;
    constructor(kind: TabFailureKind, message: string);
}
interface PageExecutor {
    query(selector: string, fields: readonly TabField[], limit?: number): TabElement[];
    /** `query`, once a first ready match is present or `waitMs` has passed (then whatever matches, possibly none). */
    queryWhenPresent(selector: string, fields: readonly TabField[], limit: number | undefined, waitMs: number): Promise<TabElement[]>;
    watch(watchId: string, selector: string, fields: readonly TabField[], onElement: (element: TabElement) => void): void;
    unwatch(watchId: string): boolean;
    /** Replace the element's previous treatment with these styles and label; neither restores it. */
    apply(treatment: TabApply): void;
    /** `apply` for each item; an element that has left the page is listed in `missing` instead of failing the rest. */
    applyMany(items: readonly TabApply[]): {
        applied: string[];
        missing: string[];
    };
    act(elementId: string, action: TabAction, text?: string): void;
}
declare function createPageExecutor(doc: Document): PageExecutor;

/** The Chrome message surface the tab port's two halves share: types only, no runtime imports. */

interface ChromeTab {
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
    windowId?: number;
}
interface ChromeTabsApi {
    query(filter: object): Promise<ChromeTab[]>;
    create(props: {
        url: string;
        active: boolean;
    }): Promise<ChromeTab>;
    remove(tab: number): Promise<void>;
    update(tab: number, props: {
        url?: string;
        active?: boolean;
    }): Promise<ChromeTab | undefined>;
    captureVisibleTab(windowId: number, options: {
        format: 'png' | 'jpeg';
        quality?: number;
    }): Promise<string>;
    sendMessage(tab: number, message: PageMessage): Promise<PageReply | undefined>;
}
interface ChromeRuntimeApi {
    sendMessage(message: PageMessage): Promise<PageReply | undefined>;
    onMessage: {
        addListener(listener: (message: PageMessage, sender: {
            tab?: ChromeTab;
        }, respond: (reply: PageReply) => void) => boolean | void): void;
    };
}
type PageMessage = {
    almadarPage: 'ready';
    url: string;
} | {
    almadarPage: 'command';
    command: TabCommand;
} | {
    almadarPage: 'element';
    watchId: string;
    element: TabElement;
    url: string;
};
/** What a content script answers a command with: its JSON result, or why it could not. */
type PageReply = {
    result: JsonValue;
} | {
    error: {
        kind: TabFailureKind;
        message: string;
    };
};

/** The content-script side: one executor over this page, answering the worker's commands. */
declare function runPageContentScript(runtime: ChromeRuntimeApi, doc: Document, url: string): void;

export { type ChromeTabsApi as C, PageCommandError as P, type TabElement as T, type ChromeRuntimeApi as a, type PageExecutor as b, type PageMessage as c, type PageReply as d, createPageExecutor as e, runPageContentScript as r };
