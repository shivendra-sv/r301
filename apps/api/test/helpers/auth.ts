import { env as testEnv } from "cloudflare:workers";
import { generateKey } from "../../src/services/keys";
import type { Env } from "../../src/types";

export interface SeededApiKey {
  id: number;
  key: string;
  prefix: string;
}

/** Inserts a live key built by the real key module, and returns its secret. */
export async function seedApiKey(): Promise<SeededApiKey> {
  const generated = await generateKey("live");
  const row = await testEnv.DB.prepare(
    `INSERT INTO api_keys (prefix, key_hash, name, environment, created_at)
     VALUES (?1, ?2, 'test key', 'live', 0) RETURNING id`,
  )
    .bind(generated.prefix, generated.hash)
    .first<{ id: number }>();

  return { id: row?.id as number, key: generated.key, prefix: generated.prefix };
}

export function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

/** Bindings for apps built directly in tests (rather than via the Worker entry). */
export function testBindings(): Env {
  return { DB: testEnv.DB, ENVIRONMENT: "local" } as Env;
}
