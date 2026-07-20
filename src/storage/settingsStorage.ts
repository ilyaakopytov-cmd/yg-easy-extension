export const SETTINGS_STORAGE_KEY = 'ygEasySettings';

import { readStorageValue, writeStorageValue, type StorageAreaName } from './storageClient';

export type ApiKeyStorageMode = 'session' | 'local';

export type ExtensionSettings = {
  apiKeyStorageMode: ApiKeyStorageMode;
  rememberApiKey: boolean;
  maskedApiKey: string;
  tokenSettings: TokenSettings;
};

const API_KEY_STORAGE_KEY = 'ygEasyApiKey';

export type TokenSettings = {
  request: TokenRequestSettings;
  list: TokenListRequestSettings;
  savedTokens: SavedTokenSummary[];
};

export type TokenRequestSettings = {
  companyId: string;
  login: string;
  password: string;
  autoSaveRequestedToken: boolean;
  rememberRequestData: boolean;
};

export type TokenListRequestSettings = {
  companyId: string;
  login: string;
  password: string;
  rememberListRequestData: boolean;
};

export type SavedTokenSummary = {
  id: string;
  name: string;
  maskedToken: string;
  visibleToken?: string;
  createdAt: string;
};

export const DEFAULT_TOKEN_SETTINGS: TokenSettings = {
  request: {
    companyId: '',
    login: '',
    password: '',
    autoSaveRequestedToken: true,
    rememberRequestData: false,
  },
  list: {
    companyId: '',
    login: '',
    password: '',
    rememberListRequestData: false,
  },
  savedTokens: [],
};

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  apiKeyStorageMode: 'session',
  rememberApiKey: false,
  maskedApiKey: '',
  tokenSettings: DEFAULT_TOKEN_SETTINGS,
};

export async function readSettings(): Promise<ExtensionSettings> {
  const settings = await readStorageValue<Partial<ExtensionSettings>>(SETTINGS_STORAGE_KEY, DEFAULT_EXTENSION_SETTINGS);
  return normalizeSettings(settings);
}

export async function writeSettings(settings: ExtensionSettings): Promise<void> {
  await writeStorageValue(SETTINGS_STORAGE_KEY, normalizeSettings(settings));
}

export async function readApiKey(mode: ApiKeyStorageMode): Promise<string> {
  return readStorageValueFromArea(API_KEY_STORAGE_KEY, '', mode);
}

export async function writeApiKey(apiKey: string, mode: ApiKeyStorageMode): Promise<void> {
  await writeStorageValueToArea(API_KEY_STORAGE_KEY, apiKey, mode);
}

async function readStorageValueFromArea<T>(
  key: string,
  fallback: T,
  area: StorageAreaName,
): Promise<T> {
  if (typeof chrome !== 'undefined' && chrome.storage?.[area]) {
    const result = await chrome.storage[area].get(key);
    return (result[key] as T | undefined) ?? fallback;
  }

  const raw = window.localStorage.getItem(`${area}:${key}`);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

async function writeStorageValueToArea<T>(
  key: string,
  value: T,
  area: StorageAreaName,
): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.[area]) {
    await chrome.storage[area].set({ [key]: value });
    return;
  }

  window.localStorage.setItem(`${area}:${key}`, JSON.stringify(value));
}

function normalizeSettings(settings: Partial<ExtensionSettings>): ExtensionSettings {
  const maskedApiKey = settings.maskedApiKey ? maskStoredSecret(settings.maskedApiKey) : '';

  return {
    ...DEFAULT_EXTENSION_SETTINGS,
    ...settings,
    maskedApiKey,
    tokenSettings: {
      request: {
        ...DEFAULT_TOKEN_SETTINGS.request,
        ...(settings.tokenSettings?.request ?? {}),
      },
      list: {
        ...DEFAULT_TOKEN_SETTINGS.list,
        ...(settings.tokenSettings?.list ?? {}),
      },
      savedTokens: Array.isArray(settings.tokenSettings?.savedTokens)
        ? settings.tokenSettings.savedTokens
        : DEFAULT_TOKEN_SETTINGS.savedTokens,
    },
  };
}

function maskStoredSecret(maskedSecret: string): string {
  return '•'.repeat(Math.max(maskedSecret.length, 8));
}
