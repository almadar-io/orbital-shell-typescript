/**
 * Context barrel export
 */

export {
  UISlotProvider,
  useUISlots,
  useSlotContent,
  useSlotHasContent,
  UISlotContext,
  type UISlotManager,
  type UISlot,
  type SlotContent,
  type SlotRenderConfig,
  type SlotChangeCallback,
} from "../providers/UISlotContext";




export {
  themeTokensToCssVars,
  resolveThemeForRuntime,
  type ThemeMode,
} from "../lib/themeTokens";

export {
  OrbitalThemeProvider,
  type OrbitalThemeProviderProps,
} from "../providers/OrbitalThemeProvider";

export { DesignThemeProvider, useDesignTheme } from "../providers/DesignThemeContext";

export {
  CurrentPagePathProvider,
  CurrentPagePathContext,
  useCurrentPagePath,
  type CurrentPagePathProviderProps,
} from "../providers/CurrentPagePathContext";

export {
  UserProvider,
  UserContext,
  useUser,
  useHasRole,
  useHasPermission,
  useUserForEvaluation,
  ANONYMOUS_USER,
  type UserData,
  type UserContextValue,
  type UserProviderProps,
} from "../providers/UserContext";

export {
  ArbitraryClassCompilerProvider,
  useArbitraryClassStyles,
  ARBITRARY_CLASS_STYLE_ID,
  type ArbitraryClassCompiler,
  type ArbitraryClassCompilerProviderProps,
} from "../providers/ArbitraryClassCompiler";
