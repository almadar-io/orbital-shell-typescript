import type { OnDeviceModelPorts } from '@almadar/core';
import { embedOnDevice, promptOnDevice } from '@almadar/shell-runtime/effects/on-device-model';
import type { EffectHandlers } from '@almadar/shell-runtime/runtime/types';

/** The `browserPrompt` and `browserEmbed` handlers over a host's ports; absent ports answer `unconfigured`. */
export function onDeviceHandlers(ports: OnDeviceModelPorts | undefined): Pick<EffectHandlers, 'browserPrompt' | 'browserEmbed'> {
  return {
    browserPrompt: (text, schemaText, key, signal) => promptOnDevice(ports, text, schemaText, key, signal),
    browserEmbed: (texts, key, signal) => embedOnDevice(ports, texts, key, signal),
  };
}
