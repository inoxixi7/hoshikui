// Progress persistence. Every access is guarded: private mode or blocked
// storage must never stop the game from running.

export interface SaveData {
  unlocked: number; // highest playable level index (0-based)
  completed: string[];
  muted: boolean;
}

const KEY = 'hoshikui.v1';
const fresh = (): SaveData => ({ unlocked: 0, completed: [], muted: false });

export function loadSave(): SaveData {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw) as Partial<SaveData>;
    return {
      unlocked: typeof d.unlocked === 'number' && d.unlocked >= 0 ? Math.floor(d.unlocked) : 0,
      completed: Array.isArray(d.completed) ? d.completed.filter((x): x is string => typeof x === 'string') : [],
      muted: d.muted === true,
    };
  } catch {
    return fresh();
  }
}

export function writeSave(d: SaveData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Storage unavailable: keep playing with in-memory progress.
  }
}

export function clearSave(): SaveData {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return fresh();
}
