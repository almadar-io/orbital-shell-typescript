/** A mount seed's lifecycle dispatch threw: names that trait and event, the original error's message kept. */
declare class TraitMountError extends Error {
    readonly trait: string;
    readonly event: string;
    readonly original: Error;
    constructor(trait: string, event: string, original: Error);
}

export { TraitMountError };
