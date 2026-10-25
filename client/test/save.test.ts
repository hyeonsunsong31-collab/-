import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { basePowerLevel, killXp, xpToNext, isConsistent, MATCH_MIN_DURATION_MS } from '@ak/shared';
import { SaveService } from '../src/net/SaveService.ts';
import { buildApp } from '../../server/src/app.ts';

/** In-memory localStorage stand-in. */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const storage = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = storage;

describe('SaveService (offline)', () => {
  beforeEach(() => storage.clear());

  it('starts a fresh level-1 profile and persists changes locally', async () => {
    const s = new SaveService();
    expect(await s.init({ offline: true })).toBe('offline');
    expect(s.profile.level).toBe(1);
    s.rename('Kakarin');
    const again = new SaveService();
    expect(again.profile.name).toBe('Kakarin');
  });

  it('awards kill XP with the shared formula and levels up with +5 points per level', async () => {
    const s = new SaveService();
    await s.init({ offline: true });
    const events: string[] = [];
    s.onProgress((e) => events.push(`${e.kind}:${e.levels ?? e.xp}`));
    const pl = basePowerLevel(s.profile.stats);
    const xp = s.reportKill(3, pl * 1.2);
    expect(xp).toBe(killXp(3, pl * 1.2, pl));
    // Grind until a level-up happens.
    let guard = 0;
    while (s.profile.level === 1 && guard++ < 100) s.reportKill(5, pl * 2);
    expect(s.profile.level).toBeGreaterThan(1);
    expect(s.profile.unspent).toBe((s.profile.level - 1) * 5);
    expect(s.profile.xp).toBeLessThan(xpToNext(s.profile.level));
    expect(events.some((e) => e.startsWith('level:'))).toBe(true);
    expect(isConsistent(s.profile)).toBe(true);
  });

  it('rejects invalid allocations and keeps the profile consistent', async () => {
    const s = new SaveService();
    await s.init({ offline: true });
    expect(s.allocate({ str: 1 })).toBe(false); // no points yet
    for (let i = 0; i < 60 && s.profile.unspent < 10; i++) s.reportKill(8, 5000);
    const unspent = s.profile.unspent;
    expect(s.allocate({ str: -1 } as never)).toBe(false);
    expect(s.allocate({ str: unspent + 1 })).toBe(false);
    expect(s.allocate({ str: 3, agi: 2 })).toBe(true);
    expect(s.profile.unspent).toBe(unspent - 5);
    expect(s.profile.stats.str).toBe(13);
    s.respec();
    expect(s.profile.stats.str).toBe(10);
    expect(s.profile.unspent).toBe(unspent);
    expect(isConsistent(s.profile)).toBe(true);
  });

  it('match wins grant +5 levels, but not when finished implausibly fast', async () => {
    const s = new SaveService();
    await s.init({ offline: true });
    const t1 = await s.startMatch('normal');
    expect(t1.bot.stats).toBeDefined();
    expect(await s.finishMatch(t1, 'win')).toBe(0); // instant "win" is rejected
    const t2 = await s.startMatch('hard');
    t2.startedAt -= MATCH_MIN_DURATION_MS + 1000;
    expect(await s.finishMatch(t2, 'win')).toBe(5);
    expect(s.profile.level).toBe(6);
    expect(s.profile.wins).toBe(1);
    expect(s.profile.unspent).toBe(25);
    const t3 = await s.startMatch('elite');
    t3.startedAt -= MATCH_MIN_DURATION_MS + 1000;
    expect(await s.finishMatch(t3, 'loss')).toBe(0);
    expect(s.profile.losses).toBe(1);
  });

  it('falls back to offline when no server answers', async () => {
    const s = new SaveService('http://127.0.0.1:9');
    expect(await s.init()).toBe('offline');
  });
});

describe('SaveService (online, real server)', async () => {
  const { app } = buildApp({ dbPath: ':memory:' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  afterAll(() => app.close());
  beforeEach(() => storage.clear());

  it('creates a guest account, syncs kills and allocations, and resumes with the stored token', async () => {
    const s = new SaveService(base);
    expect(await s.init()).toBe('online');
    const id = s.profile.id;
    for (let i = 0; i < 12; i++) s.reportKill(6, 3000);
    const local = { ...s.profile };
    await s.settle();
    // The server ran the same rules: identical level / XP.
    expect(s.profile.level).toBe(local.level);
    expect(s.profile.xp).toBe(local.xp);
    expect(s.profile.level).toBeGreaterThan(1);
    expect(s.allocate({ ki: 2, foc: 3 })).toBe(true);
    await s.settle();
    expect(s.profile.stats.ki).toBe(12);
    // A new session with the same stored token resumes the same account.
    const s2 = new SaveService(base);
    expect(await s2.init()).toBe('online');
    expect(s2.profile.id).toBe(id);
    expect(s2.profile.stats.foc).toBe(13);
    expect(isConsistent(s2.profile)).toBe(true);
  });

  it('server-validated match flow and leaderboard', async () => {
    const s = new SaveService(base);
    await s.init();
    const t = await s.startMatch('normal');
    expect(t.id.startsWith('local-')).toBe(false);
    // Finishing instantly is rejected server-side too: the profile is re-synced to the server's copy.
    await s.finishMatch(t, 'win');
    await s.settle();
    expect(s.profile.level).toBe(1);
    const board = await s.leaderboard();
    expect(board.length).toBeGreaterThan(0);
  });
});
