/** Stackable combat buffs / debuffs. */

export type ModKey =
  | 'dmgPct'
  | 'atkSpdPct'
  | 'critRate'
  | 'critDmg'
  | 'atkPct'
  | 'defPct'
  | 'drainPct'
  | 'beamPct'
  | 'defDownPct'
  | 'dazeTakenPct'
  | 'moveSpdPct';

export type BuffId = 'momentum' | 'instinct' | 'zenkai' | 'mastery' | 'overcharge' | 'guardCrack' | 'static';

export interface BuffDef {
  id: BuffId;
  name: string;
  /** Glyph shown in the HUD icon. */
  glyph: string;
  color: string;
  kind: 'buff' | 'debuff';
  maxStacks: number;
  /** Seconds; Infinity = until removed. */
  duration: number;
  /** On expiry: drop every stack, or just one (then the timer restarts). */
  expire: 'all' | 'one';
  perStack: Partial<Record<ModKey, number>>;
  desc: string;
}

export const BUFFS: Record<BuffId, BuffDef> = {
  momentum: {
    id: 'momentum', name: 'Combo Momentum', glyph: '»', color: '#ffc21a', kind: 'buff', maxStacks: 10, duration: 3,
    expire: 'all', perStack: { dmgPct: 0.02, atkSpdPct: 0.01 }, desc: '+2% DMG, +1% attack speed per stack. Lost when hit.',
  },
  instinct: {
    id: 'instinct', name: 'Instinct', glyph: '◈', color: '#c8d4ff', kind: 'buff', maxStacks: 3, duration: 8,
    expire: 'one', perStack: { critRate: 0.05, critDmg: 0.1 }, desc: '+5% crit rate, +10% crit DMG per perfect dodge.',
  },
  zenkai: {
    id: 'zenkai', name: 'Zenkai Rage', glyph: '✦', color: '#ff4a3a', kind: 'buff', maxStacks: 5, duration: 15,
    expire: 'one', perStack: { atkPct: 0.04, defPct: 0.04 }, desc: 'Pushed to the brink: +4% ATK and DEF per stack.',
  },
  mastery: {
    id: 'mastery', name: 'Form Mastery', glyph: '❖', color: '#3cf2ff', kind: 'buff', maxStacks: 10, duration: Infinity,
    expire: 'all', perStack: { drainPct: -0.05, dmgPct: 0.01 }, desc: '-5% Surge drain, +1% DMG per stack while transformed.',
  },
  overcharge: {
    id: 'overcharge', name: 'Overcharge', glyph: 'ϟ', color: '#7fd4ff', kind: 'buff', maxStacks: 5, duration: 6,
    expire: 'all', perStack: { beamPct: 0.12 }, desc: '+12% ki beam / ultimate DMG per consecutive ki hit.',
  },
  guardCrack: {
    id: 'guardCrack', name: 'Guard Crack', glyph: '⛉', color: '#ff8a3a', kind: 'debuff', maxStacks: 5, duration: 6,
    expire: 'one', perStack: { defDownPct: 0.06 }, desc: '-6% DEF per stack.',
  },
  static: {
    id: 'static', name: 'Static Charge', glyph: 'ϟ', color: '#9fd8ff', kind: 'debuff', maxStacks: 5, duration: 5,
    expire: 'one', perStack: { dazeTakenPct: 0.05 }, desc: '+5% Daze taken per stack (electric ki).',
  },
};

export interface BuffInstance {
  id: BuffId;
  stacks: number;
  remaining: number;
}

export class BuffSet {
  readonly list: BuffInstance[] = [];

  add(id: BuffId, stacks = 1): BuffInstance {
    const def = BUFFS[id];
    let inst = this.list.find((b) => b.id === id);
    if (!inst) {
      inst = { id, stacks: 0, remaining: def.duration };
      this.list.push(inst);
    }
    inst.stacks = Math.min(def.maxStacks, inst.stacks + stacks);
    inst.remaining = def.duration;
    return inst;
  }

  remove(id: BuffId): void {
    const i = this.list.findIndex((b) => b.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  stacksOf(id: BuffId): number {
    return this.list.find((b) => b.id === id)?.stacks ?? 0;
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const def = BUFFS[b.id];
      if (!Number.isFinite(def.duration)) continue;
      b.remaining -= dt;
      if (b.remaining <= 0) {
        if (def.expire === 'one' && b.stacks > 1) {
          b.stacks--;
          b.remaining = def.duration;
        } else {
          this.list.splice(i, 1);
        }
      }
    }
  }

  total(mod: ModKey): number {
    let t = 0;
    for (const b of this.list) t += (BUFFS[b.id].perStack[mod] ?? 0) * b.stacks;
    return t;
  }

  clear(): void {
    this.list.length = 0;
  }
}
