export type StorageAreaName = 'local' | 'session';

export function getStorageArea(area: StorageAreaName = 'local') {
  return chrome.storage[area];
}

export async function readStorageValue<T>(key: string, fallback: T): Promise<T> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(key);
      return (result[key] as T | undefined) ?? fallback;
    }

    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeStorageValue<T>(key: string, value: T): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

export async function removeStorageValue(key: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.remove(key);
    return;
  }

  window.localStorage.removeItem(key);
}
