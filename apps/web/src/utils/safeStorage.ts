const memoryStorage = new Map<string, string>();
const memorySessionStorage = new Map<string, string>();

export function safeGetItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Fallback when third-party storage is blocked (e.g., Brave Shields / sandboxed iframe)
  }
  return memoryStorage.get(key) ?? null;
}

export function safeSetItem(key: string, value: string): void {
  memoryStorage.set(key, value);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage access errors in restricted iframes
  }
}

export function safeRemoveItem(key: string): void {
  memoryStorage.delete(key);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors in restricted iframes
  }
}

export function safeSessionGet(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(key);
    }
  } catch {
    // Fallback when sessionStorage is blocked
  }
  return memorySessionStorage.get(key) ?? null;
}

export function safeSessionSet(key: string, value: string): void {
  memorySessionStorage.set(key, value);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage access errors
  }
}

export function safeSessionRemove(key: string): void {
  memorySessionStorage.delete(key);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors
  }
}
