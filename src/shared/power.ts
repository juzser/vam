/**
 * "Keep computer awake" 's one shared type -- `KeepAwakeMode` crosses the
 * renderer/main boundary three times (`prefs/keep-awake.ts`'s own field,
 * `main/power/power-save.ts`'s state machine, and `preload/api.ts`'s bridge
 * member), the same reason `shared/providers.ts` holds `ProviderId`: one
 * declaration, not three that happen to agree today.
 */

export type KeepAwakeMode = 'on' | 'while-running' | 'off';
