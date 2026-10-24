import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import {
  newProfile,
  allocate,
  respec,
  addXp,
  grantLevels,
  killXp,
  isConsistent,
  sanitizeName,
  basePowerLevel,
  generateRival,
  MATCH_WIN_LEVELS,
  MATCH_MIN_DURATION_MS,
  MATCH_MAX_DURATION_MS,
  DIFFICULTIES,
  hashString,
  type Difficulty,
  type Profile,
  type StatKey,
} from '@ak/shared';
import { Store } from './db.ts';
import { authenticate, hashToken, newId, newToken } from './auth.ts';

export interface AppOptions {
  dbPath: string;
  staticDir?: string;
  /** Injectable clock for tests. */
  now?: () => number;
  logger?: boolean;
}

/** Max kills accepted per rolling minute — anything above is clearly forged. */
const MAX_KILLS_PER_MINUTE = 60;
const MAX_KILLS_PER_REPORT = 20;

export function buildApp(opts: AppOptions): { app: FastifyInstance; store: Store } {
  const now = opts.now ?? (() => Date.now());
  const store = new Store(opts.dbPath);
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024 });

  app.addHook('onClose', async () => store.close());

  const requirePlayer = (req: FastifyRequest, reply: FastifyReply): Profile | null => {
    const id = authenticate(req, store);
    const p = id ? store.getPlayer(id) : null;
    if (!p) {
      void reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return p;
  };

  app.get('/api/health', async () => ({ ok: true, time: now() }));

  app.post<{ Body: { name?: string } }>('/api/guest', async (req) => {
    const id = newId();
    const token = newToken();
    const profile = newProfile(id, req.body?.name ?? 'Wanderer', now());
    store.createPlayer(profile, hashToken(token));
    return { id, token, profile };
  });

  app.get('/api/profile', async (req, reply) => {
    const p = requirePlayer(req, reply);
    if (!p) return reply;
    return { profile: p };
  });

  app.post<{ Body: { name?: string } }>('/api/profile/name', async (req, reply) => {
    const p = requirePlayer(req, reply);
    if (!p) return reply;
    const next = { ...p, name: sanitizeName(req.body?.name ?? ''), updatedAt: now() };
    store.savePlayer(next);
    return { profile: next };
  });

  app.post<{ Body: { delta?: Partial<Record<StatKey, number>> } }>('/api/profile/allocate', async (req, reply) => {
    const p = requirePlayer(req, reply);
    if (!p) return reply;
    const r = allocate(p, req.body?.delta ?? {}, now());
    if (!r.ok) return reply.code(400).send({ error: r.error });
    if (!isConsistent(r.profile)) return reply.code(409).send({ error: 'inconsistent' });
    store.savePlayer(r.profile);
    return { profile: r.profile };
  });

  app.post('/api/profile/respec', async (req, reply) => {
    const p = requirePlayer(req, reply);
    if (!p) return reply;
    const next = respec(p, now());
    store.savePlayer(next);
    return { profile: next };
  });

  app.post<{ Body: { kills?: { level: number; pl: number }[] } }>('/api/progress/kills', async (req, reply) => {
    const p = requirePlayer(req, reply);
    if (!p) return reply;
    const kills = Array.isArray(req.body?.kills) ? req.body.kills : [];
    if (kills.length === 0 || kills.length > MAX_KILLS_PER_REPORT) return reply.code(400).send({ error: 'invalid' });
    const t = now();
    if (store.killsSince(p.id, t - 60_000) + kills.length > MAX_KILLS_PER_MINUTE) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    const playerPL = basePowerLevel(p.stats);
    let xp = 0;
    for (const k of kills) {
      const level = Math.max(1, Math.min(999, Math.floor(Number(k?.level) || 1)));
      // Clamp reported enemy PL to a plausible band around what that level could have.
      const pl = Math.max(1, Math.min(Number(k?.pl) || 1, playerPL * 4 + level * 400));
      xp += killXp(level, pl, playerPL);
    }
    store.logKills(p.id, t, kills.length);
    const r = addXp(p, xp, t);
    store.savePlayer(r.profile);
    return { profile: r.profile, xp, levelsGained: r.levelsGained };
  });

  app.post<{ Body: { difficulty?: Difficulty } }>('/api/match/start', async (req, reply) => {
    const p = requirePlayer(req, reply);
    if (!p) return reply;
    const difficulty = req.body?.difficulty ?? 'normal';
    if (!(difficulty in DIFFICULTIES)) return reply.code(400).send({ error: 'invalid' });
    const id = newId();
    const t = now();
    const bot = generateRival(p.stats, p.level, difficulty, hashString(id));
    store.createMatch({ id, playerId: p.id, bot, startedAt: t, finishedAt: null, result: null });
    return { matchId: id, bot };
  });

  app.post<{ Body: { matchId?: string; result?: 'win' | 'loss' } }>('/api/match/finish', async (req, reply) => {
    const p = requirePlayer(req, reply);
    if (!p) return reply;
    const m = req.body?.matchId ? store.getMatch(req.body.matchId) : null;
    const result = req.body?.result;
    if (!m || m.playerId !== p.id || (result !== 'win' && result !== 'loss')) {
      return reply.code(400).send({ error: 'invalid' });
    }
    if (m.finishedAt !== null) return reply.code(409).send({ error: 'already_finished' });
    const t = now();
    const elapsed = t - m.startedAt;
    if (result === 'win' && elapsed < MATCH_MIN_DURATION_MS) return reply.code(400).send({ error: 'too_fast' });
    if (elapsed > MATCH_MAX_DURATION_MS) return reply.code(400).send({ error: 'expired' });
    if (!store.finishMatch(m.id, result, t)) return reply.code(409).send({ error: 'already_finished' });
    let next: Profile;
    if (result === 'win') next = { ...grantLevels(p, MATCH_WIN_LEVELS, t), wins: p.wins + 1 };
    else next = { ...p, losses: p.losses + 1, updatedAt: t };
    store.savePlayer(next);
    return { profile: next, levelsGained: result === 'win' ? next.level - p.level : 0 };
  });

  app.get('/api/leaderboard', async () => {
    return {
      entries: store.leaderboard(20).map((p) => ({ name: p.name, level: p.level, bestPL: p.bestPL, wins: p.wins })),
    };
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    void app.register(fastifyStatic, { root: opts.staticDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  }

  return { app, store };
}
