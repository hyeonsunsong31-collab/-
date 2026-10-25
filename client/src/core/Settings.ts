import type { QualityLevel } from '../render/Quality.ts';

export interface SettingsData {
  quality: QualityLevel | 'auto';
  sensitivity: number;
  invertY: boolean;
  shake: number;
  master: number;
  music: number;
  sfx: number;
  damageNumbers: boolean;
  touch: 'auto' | 'on' | 'off';
}

const KEY = 'ak.settings';

export const DEFAULT_SETTINGS: SettingsData = {
  quality: 'auto',
  sensitivity: 1,
  invertY: false,
  shake: 1,
  master: 0.8,
  music: 0.55,
  sfx: 0.85,
  damageNumbers: true,
  touch: 'auto',
};

/** Player preferences persisted per browser (all optional conveniences; defaults always work). */
export class Settings {
  data: SettingsData;
  private listeners = new Set<(s: SettingsData, key: keyof SettingsData) => void>();

  constructor() {
    let stored: Partial<SettingsData> = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<SettingsData>;
    } catch {
      stored = {};
    }
    this.data = { ...DEFAULT_SETTINGS, ...stored };
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      if (key === 'quality') {
        if (value === 'auto') localStorage.removeItem('ak.quality');
        else localStorage.setItem('ak.quality', String(value));
      }
    } catch {
      /* session-only */
    }
    for (const fn of this.listeners) fn(this.data, key);
  }

  onChange(fn: (s: SettingsData, key: keyof SettingsData) => void): void {
    this.listeners.add(fn);
  }
}
