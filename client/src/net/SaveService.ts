import {
  addXp,
  allocate,
  generateRival,
  grantLevels,
  killXp,
  basePowerLevel,
  newProfile,
  respec,
  sanitizeName,
  MATCH_MIN_DURATION_MS,
  MATCH_WIN_LEVELS,
  type BotSpec,
  type Difficulty,
  type Profile,
  type StatKey,
} from '@ak/shared';
import { Api, ApiError, type Auth } from './Api.ts';

const K_AUTH = 'ak.auth';
const K_LOCAL = 'ak.profile';
const K_CACHE = 'ak.profile.cache';

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode / quota: progress lives for this session only */
  }
}

function validProfile(p: unknown): p is Profile {
  const q = p as Profile | null;
  return !!q && typeof q.level === 'number' && typeof q.xp === 'number' && !!q.stats && typeof q.stats.str === 'number';
}

export type SaveMode = 'online' | 'offline';

export interface ProgressEvent {
  kind: 'xp' | 'level' | 'match';
  xp?: number;
  levels?: number;
  profile: Profile;
}

export interface MatchTicket {
  id: string;
  bot: BotSpec;
  startedAt: number;
}

export interface LeaderEntry {
  name: string;
  level: number;
  bestPL: number;
  wins: number;
  you?: boolean;
}

/**
 * The single source of the player's persistent profile. Online it talks to the game server (which re-validates
 * every allocation, XP report and match result); with no server reachable (static build, offline) it runs the
 * exact same `shared/` rules locally and persists to localStorage. Every mutation is applied locally first so the
 * UI reacts instantly, then mirrored to the server through a serial queue; the server's answer is adopted once
 * nothing newer is pending.
 */
export class SaveService {
  mode: SaveMode = 'offline';
  profile: Profile;
  private api: Api;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private killBatch: { level: number; pl: number }[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private listeners = new Set<(p: Profile) => void>();
  private progressListeners = new Set<(e: ProgressEvent) => void>();

  constructor(apiBase = '') {
    this.api = new Api(apiBase);
    const local = load<Profile>(K_LOCAL);
    this.profile = validProfile(local) ? local : newProfile('local', 'Wanderer');
  }

  /** Connect to the server if one answers; otherwise stay offline with the local profile. */
  async init(opts: { offline?: boolean } = {}): Promise<SaveMode> {
    if (opts.offline) return this.goOffline();
    try {
      await this.api.health();
    } catch {
      return this.goOffline();
    }
    try {
      const auth = load<Auth>(K_AUTH);
      if (auth?.id && auth.token) {
        this.api.auth = auth;
        try {
          const r = await this.api.profile();
          this.adopt(r.profile, true);
          this.mode = 'online';
          return this.mode;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) throw e;
        }
      }
      // New guest account; carries over the local name.
      const g = await this.api.guest(this.profile.name);
      this.api.auth = { id: g.id, token: g.token };
      store(K_AUTH, this.api.auth);
      this.adopt(g.profile, true);
      this.mode = 'online';
    } catch {
      return this.goOffline();
    }
    return this.mode;
  }

  private goOffline(): SaveMode {
    this.mode = 'offline';
    this.api.auth = null;
    return this.mode;
  }

  onChange(fn: (p: Profile) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onProgress(fn: (e: ProgressEvent) => void): () => void {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  private set(p: Profile): void {
    this.profile = p;
    store(this.mode === 'online' ? K_CACHE : K_LOCAL, p);
    for (const fn of this.listeners) fn(p);
  }

  /** Take the server's profile as truth unless newer local edits are still in flight. */
  private adopt(p: Profile, force = false): void {
    if (!force && this.pending > 0) return;
    if (!validProfile(p)) return;
    this.set(p);
  }

  /** Serialise a server mutation; on failure re-sync from the server (or drop to offline). */
  private sync<T extends { profile: Profile }>(call: () => Promise<T>): Promise<T | null> {
    if (this.mode !== 'online') return Promise.resolve(null);
    this.pending++;
    const run = this.queue.then(async () => {
      try {
        const r = await call();
        this.pending--;
        this.adopt(r.profile);
        return r;
      } catch (e) {
        this.pending--;
        if (e instanceof ApiError && e.status !== 429) {
          // Rejected (stale / inconsistent): the server's copy wins.
          try {
            this.adopt((await this.api.profile()).profile, true);
          } catch {
            /* keep local */
          }
        } else if (!(e instanceof ApiError)) {
          // Network gone: keep playing offline with what we have.
          store(K_LOCAL, this.profile);
          this.goOffline();
        }
        return null;
      }
    });
    this.queue = run.catch(() => null);
    return run;
  }

  private emit(e: ProgressEvent): void {
    for (const fn of this.progressListeners) fn(e);
  }

  /* -------------------------------------------------------------- stats */

  /** Spend points. Returns false if the allocation is invalid. */
  allocate(delta: Partial<Record<StatKey, number>>): boolean {
    const r = allocate(this.profile, delta);
    if (!r.ok) return false;
    this.set(r.profile);
    void this.sync(() => this.api.allocate(delta));
    return true;
  }

  respec(): void {
    this.set(respec(this.profile));
    void this.sync(() => this.api.respec());
  }

  rename(name: string): void {
    this.set({ ...this.profile, name: sanitizeName(name), updatedAt: Date.now() });
    void this.sync(() => this.api.rename(name));
  }

  /* -------------------------------------------------------------- kills / XP */

  /** Award a defeated enemy. XP shows instantly; online, kills are batched to the server. */
  reportKill(level: number, pl: number): number {
    const before = this.profile;
    const xp = killXp(level, pl, basePowerLevel(before.stats));
    const r = addXp(before, xp);
    this.set(r.profile);
    this.emit({ kind: 'xp', xp, profile: r.profile });
    if (r.levelsGained > 0) this.emit({ kind: 'level', levels: r.levelsGained, profile: r.profile });
    if (this.mode === 'online') {
      this.killBatch.push({ level, pl: Math.round(pl) });
      this.pending++;
      if (this.killBatch.length >= 20) this.flushKills();
      else if (!this.flushTimer) this.flushTimer = globalThis.setTimeout(() => this.flushKills(), 2500);
    }
    return xp;
  }

  /** Resolves once every queued server call has settled (tests, page unload). */
  async settle(): Promise<void> {
    this.flushKills();
    await this.queue;
  }

  flushKills(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    const batch = this.killBatch.splice(0, 20);
    if (!batch.length) return;
    // These kills were counted as pending when queued; hand the count over to the request.
    this.pending -= batch.length;
    void this.sync(() => this.api.kills(batch));
    if (this.killBatch.length) this.flushTimer = globalThis.setTimeout(() => this.flushKills(), 1200);
  }

  /* -------------------------------------------------------------- training matches */

  async startMatch(difficulty: Difficulty): Promise<MatchTicket> {
    if (this.mode === 'online') {
      try {
        const r = await this.api.matchStart(difficulty);
        return { id: r.matchId, bot: r.bot, startedAt: performance.now() };
      } catch {
        /* fall through to a local match */
      }
    }
    const seed = Math.floor(Math.random() * 2 ** 31);
    return {
      id: `local-${seed.toString(36)}`,
      bot: generateRival(this.profile.stats, this.profile.level, difficulty, seed),
      startedAt: performance.now(),
    };
  }

  /** Report the result; a win grants +5 levels (+25 stat points). Returns the levels gained. */
  async finishMatch(ticket: MatchTicket, result: 'win' | 'loss'): Promise<number> {
    const before = this.profile;
    const tooFast = performance.now() - ticket.startedAt < MATCH_MIN_DURATION_MS;
    let next: Profile;
    if (result === 'win' && !tooFast) next = { ...grantLevels(before, MATCH_WIN_LEVELS), wins: before.wins + 1 };
    else if (result === 'win') next = before;
    else next = { ...before, losses: before.losses + 1, updatedAt: Date.now() };
    this.set(next);
    if (this.mode === 'online' && !ticket.id.startsWith('local-')) {
      const r = await this.sync(() => this.api.matchFinish(ticket.id, result));
      if (r) next = r.profile;
    }
    const levels = next.level - before.level;
    this.emit({ kind: 'match', levels, profile: this.profile });
    return levels;
  }

  /* -------------------------------------------------------------- leaderboard */

  async leaderboard(): Promise<LeaderEntry[]> {
    const me = this.profile;
    if (this.mode === 'online') {
      try {
        const r = await this.api.leaderboard();
        return r.entries.map((e) => ({ ...e, you: e.name === me.name && e.level === me.level }));
      } catch {
        /* offline list below */
      }
    }
    return [{ name: me.name, level: me.level, bestPL: me.bestPL, wins: me.wins, you: true }];
  }
}
