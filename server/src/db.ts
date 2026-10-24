import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Profile, BotSpec } from '@ak/shared';

export interface MatchRow {
  id: string;
  playerId: string;
  bot: BotSpec;
  startedAt: number;
  finishedAt: number | null;
  result: 'win' | 'loss' | null;
}

/** Thin persistence layer over node:sqlite. Profiles are stored as JSON documents. */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        data TEXT NOT NULL,
        best_pl INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS players_best_pl ON players(best_pl DESC);
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        bot TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        result TEXT
      );
      CREATE TABLE IF NOT EXISTS kill_log (
        player_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);
  }

  createPlayer(p: Profile, tokenHash: string): void {
    this.db
      .prepare('INSERT INTO players (id, token_hash, data, best_pl, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, tokenHash, JSON.stringify(p), p.bestPL, p.updatedAt);
  }

  tokenHash(id: string): string | null {
    const row = this.db.prepare('SELECT token_hash FROM players WHERE id = ?').get(id) as { token_hash: string } | undefined;
    return row?.token_hash ?? null;
  }

  getPlayer(id: string): Profile | null {
    const row = this.db.prepare('SELECT data FROM players WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Profile) : null;
  }

  savePlayer(p: Profile): void {
    this.db
      .prepare('UPDATE players SET data = ?, best_pl = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(p), p.bestPL, p.updatedAt, p.id);
  }

  leaderboard(limit: number): Profile[] {
    const rows = this.db.prepare('SELECT data FROM players ORDER BY best_pl DESC LIMIT ?').all(limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Profile);
  }

  createMatch(m: MatchRow): void {
    this.db
      .prepare('INSERT INTO matches (id, player_id, bot, started_at) VALUES (?, ?, ?, ?)')
      .run(m.id, m.playerId, JSON.stringify(m.bot), m.startedAt);
  }

  getMatch(id: string): MatchRow | null {
    const row = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as
      | { id: string; player_id: string; bot: string; started_at: number; finished_at: number | null; result: string | null }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      playerId: row.player_id,
      bot: JSON.parse(row.bot) as BotSpec,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      result: (row.result as MatchRow['result']) ?? null,
    };
  }

  finishMatch(id: string, result: 'win' | 'loss', at: number): boolean {
    const r = this.db
      .prepare('UPDATE matches SET finished_at = ?, result = ? WHERE id = ? AND finished_at IS NULL')
      .run(at, result, id);
    return Number(r.changes) === 1;
  }

  logKills(playerId: string, at: number, count: number): void {
    this.db.prepare('INSERT INTO kill_log (player_id, at, count) VALUES (?, ?, ?)').run(playerId, at, count);
  }

  killsSince(playerId: string, since: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM kill_log WHERE player_id = ? AND at >= ?')
      .get(playerId, since) as { n: number };
    return Number(row.n);
  }

  close(): void {
    this.db.close();
  }
}
