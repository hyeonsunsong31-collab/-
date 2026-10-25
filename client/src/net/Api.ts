import type { BotSpec, Difficulty, Profile, StatKey } from '@ak/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export interface Auth {
  id: string;
  token: string;
}

/** Thin typed client for the game server's REST API. */
export class Api {
  auth: Auth | null = null;

  constructor(private base = '') {}

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 6000): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.auth ? { Authorization: `Bearer ${this.auth.id}.${this.auth.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'error');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<{ ok: boolean; time: number }> {
    return this.req('GET', '/api/health', undefined, 2500);
  }

  guest(name?: string): Promise<{ id: string; token: string; profile: Profile }> {
    return this.req('POST', '/api/guest', { name });
  }

  profile(): Promise<{ profile: Profile }> {
    return this.req('GET', '/api/profile');
  }

  rename(name: string): Promise<{ profile: Profile }> {
    return this.req('POST', '/api/profile/name', { name });
  }

  allocate(delta: Partial<Record<StatKey, number>>): Promise<{ profile: Profile }> {
    return this.req('POST', '/api/profile/allocate', { delta });
  }

  respec(): Promise<{ profile: Profile }> {
    return this.req('POST', '/api/profile/respec', {});
  }

  kills(kills: { level: number; pl: number }[]): Promise<{ profile: Profile; xp: number; levelsGained: number }> {
    return this.req('POST', '/api/progress/kills', { kills });
  }

  matchStart(difficulty: Difficulty): Promise<{ matchId: string; bot: BotSpec }> {
    return this.req('POST', '/api/match/start', { difficulty });
  }

  matchFinish(matchId: string, result: 'win' | 'loss'): Promise<{ profile: Profile; levelsGained: number }> {
    return this.req('POST', '/api/match/finish', { matchId, result });
  }

  leaderboard(): Promise<{ entries: { name: string; level: number; bestPL: number; wins: number }[] }> {
    return this.req('GET', '/api/leaderboard');
  }
}
