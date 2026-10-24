import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { xpToNext, MATCH_MIN_DURATION_MS, type Profile } from '@ak/shared';

let app: FastifyInstance;
let clock = 1_000_000;

beforeEach(() => {
  clock = 1_000_000;
  app = buildApp({ dbPath: ':memory:', now: () => clock }).app;
});
afterEach(async () => {
  await app.close();
});

async function guest(name = 'Tester'): Promise<{ auth: string; profile: Profile }> {
  const r = await app.inject({ method: 'POST', url: '/api/guest', payload: { name } });
  expect(r.statusCode).toBe(200);
  const b = r.json() as { id: string; token: string; profile: Profile };
  return { auth: `Bearer ${b.id}.${b.token}`, profile: b.profile };
}

describe('api', () => {
  it('creates a guest and reads the profile', async () => {
    const g = await guest('Kai');
    expect(g.profile.name).toBe('Kai');
    const r = await app.inject({ method: 'GET', url: '/api/profile', headers: { authorization: g.auth } });
    expect(r.json().profile.level).toBe(1);
  });

  it('rejects bad auth', async () => {
    const g = await guest();
    const bad = g.auth.slice(0, -2) + 'xx';
    const r = await app.inject({ method: 'GET', url: '/api/profile', headers: { authorization: bad } });
    expect(r.statusCode).toBe(401);
  });

  it('kill reports grant xp and levels (+5 points per level)', async () => {
    const g = await guest();
    const kills = Array.from({ length: 10 }, () => ({ level: 3, pl: 900 }));
    const r = await app.inject({ method: 'POST', url: '/api/progress/kills', headers: { authorization: g.auth }, payload: { kills } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { profile: Profile; xp: number; levelsGained: number };
    expect(body.xp).toBeGreaterThan(xpToNext(1));
    expect(body.profile.unspent).toBe(body.levelsGained * 5);
  });

  it('rate-limits forged kill floods', async () => {
    const g = await guest();
    const kills = Array.from({ length: 20 }, () => ({ level: 1, pl: 100 }));
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/progress/kills', headers: { authorization: g.auth }, payload: { kills } });
      expect(r.statusCode).toBe(200);
    }
    const r = await app.inject({ method: 'POST', url: '/api/progress/kills', headers: { authorization: g.auth }, payload: { kills } });
    expect(r.statusCode).toBe(429);
  });

  it('allocation is validated server-side', async () => {
    const g = await guest();
    let r = await app.inject({ method: 'POST', url: '/api/profile/allocate', headers: { authorization: g.auth }, payload: { delta: { str: 1 } } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('insufficient');
    // win a match for points
    const s = await app.inject({ method: 'POST', url: '/api/match/start', headers: { authorization: g.auth }, payload: { difficulty: 'normal' } });
    clock += MATCH_MIN_DURATION_MS + 1;
    await app.inject({ method: 'POST', url: '/api/match/finish', headers: { authorization: g.auth }, payload: { matchId: s.json().matchId, result: 'win' } });
    r = await app.inject({ method: 'POST', url: '/api/profile/allocate', headers: { authorization: g.auth }, payload: { delta: { str: 20, foc: 5 } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().profile.stats.str).toBe(30);
    expect(r.json().profile.unspent).toBe(0);
  });

  it('match win = +5 levels; replay and too-fast wins rejected', async () => {
    const g = await guest();
    const s = await app.inject({ method: 'POST', url: '/api/match/start', headers: { authorization: g.auth }, payload: { difficulty: 'hard' } });
    expect(s.statusCode).toBe(200);
    const { matchId, bot } = s.json();
    expect(bot.stats).toBeTruthy();
    const fast = await app.inject({ method: 'POST', url: '/api/match/finish', headers: { authorization: g.auth }, payload: { matchId, result: 'win' } });
    expect(fast.statusCode).toBe(400);
    clock += MATCH_MIN_DURATION_MS + 500;
    const ok = await app.inject({ method: 'POST', url: '/api/match/finish', headers: { authorization: g.auth }, payload: { matchId, result: 'win' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile.level).toBe(6);
    expect(ok.json().profile.unspent).toBe(25);
    expect(ok.json().profile.wins).toBe(1);
    const replay = await app.inject({ method: 'POST', url: '/api/match/finish', headers: { authorization: g.auth }, payload: { matchId, result: 'win' } });
    expect(replay.statusCode).toBe(409);
  });

  it('cannot finish another player\'s match', async () => {
    const a = await guest('Aa');
    const b = await guest('Bb');
    const s = await app.inject({ method: 'POST', url: '/api/match/start', headers: { authorization: a.auth }, payload: {} });
    clock += MATCH_MIN_DURATION_MS + 1;
    const r = await app.inject({ method: 'POST', url: '/api/match/finish', headers: { authorization: b.auth }, payload: { matchId: s.json().matchId, result: 'win' } });
    expect(r.statusCode).toBe(400);
  });

  it('leaderboard orders by best PL', async () => {
    const a = await guest('Low');
    const b = await guest('High');
    const s = await app.inject({ method: 'POST', url: '/api/match/start', headers: { authorization: b.auth }, payload: {} });
    clock += MATCH_MIN_DURATION_MS + 1;
    await app.inject({ method: 'POST', url: '/api/match/finish', headers: { authorization: b.auth }, payload: { matchId: s.json().matchId, result: 'win' } });
    await app.inject({ method: 'POST', url: '/api/profile/allocate', headers: { authorization: b.auth }, payload: { delta: { str: 5, ki: 5, vit: 5, agi: 5, imp: 5 } } });
    void a;
    const r = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    const entries = r.json().entries as { name: string; bestPL: number }[];
    expect(entries[0].name).toBe('High');
    expect(entries[0].bestPL).toBeGreaterThan(entries[1].bestPL);
  });
});
