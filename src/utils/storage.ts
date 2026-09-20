export const STORAGE_KEYS = {
  progress: 'madhav-dsa:progress',
  settings: 'madhav-dsa:settings',
  corruptBackup: 'madhav-dsa:progress:corrupt-backup',
} as const;

// localStorage can throw (private mode, quota, disabled). Never let that crash the app.
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): boolean {
  try {
    if (window.localStorage.getItem(key) === value) return true;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
