import { OnDeviceFailureKind, OnDeviceFailurePayload, OnDeviceModelPorts } from '@almadar/core';

/**
 * `browser/prompt` and `browser/embed`: the host's on-device model and embedder behind one contract, shared by the
 * interpreter (`EffectExecutor`) and the kernel host (`answerRequest`). A host with no port fails `unconfigured`, a
 * model that cannot answer now fails `unavailable`, and one that errors fails `failed`.
 */

declare const NO_ON_DEVICE_MODEL = "browser/prompt: no on-device model is wired into this host";
declare const NO_ON_DEVICE_EMBEDDER = "browser/embed: no on-device embedder is wired into this host";
/** An on-device call that gave no answer; `payload` is what the failure route receives. */
declare class OnDeviceModelFailure extends Error {
    readonly kind: OnDeviceFailureKind;
    readonly payload: OnDeviceFailurePayload;
    constructor(kind: OnDeviceFailureKind, message: string, key: string | null);
}
/** The reply text of one prompt; the schema text must be a JSON object. */
declare function promptOnDevice(ports: OnDeviceModelPorts | undefined, text: string, schemaText: string, key: string | null, signal?: AbortSignal): Promise<string>;
/** One vector per text, in input order; an empty list is answered without asking the embedder. */
declare function embedOnDevice(ports: OnDeviceModelPorts | undefined, texts: readonly string[], key: string | null, signal?: AbortSignal): Promise<number[][]>;

export { NO_ON_DEVICE_EMBEDDER, NO_ON_DEVICE_MODEL, OnDeviceModelFailure, embedOnDevice, promptOnDevice };
