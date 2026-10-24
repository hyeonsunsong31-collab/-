import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Store } from './db.ts';

export function newId(): string {
  return randomBytes(9).toString('base64url');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Resolves `Authorization: Bearer <id>.<token>` to a player id, or null. */
export function authenticate(req: FastifyRequest, store: Store): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const raw = h.slice(7).trim();
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  const expected = store.tokenHash(id);
  if (!expected) return null;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}
