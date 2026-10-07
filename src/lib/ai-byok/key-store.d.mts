import type { AiSettings } from "./providers.mjs";

export interface SettingsStores {
  session?: Storage | null;
  local?: Storage | null;
}

export declare const STORAGE_KEY: string;
export declare function loadSettings(stores: SettingsStores): AiSettings & { remember: boolean };
export declare function saveSettings(stores: SettingsStores, settings: AiSettings, remember: boolean): boolean;
export declare function forgetSettings(stores: SettingsStores): void;
export declare function browserStores(): { session: Storage | null; local: Storage | null };
