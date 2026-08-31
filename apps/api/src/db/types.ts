/** Row shapes as stored in D1 (migration 0001 / PRD §9). Epoch ms, snake_case. */

export interface ApiKeyRow {
  id: number;
  key_hash: string;
  environment: string;
  revoked_at: number | null;
  last_used_at: number | null;
}
