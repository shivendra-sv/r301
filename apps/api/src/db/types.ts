/** Row shapes as stored in D1 (migration 0001 / PRD §9). Epoch ms, snake_case. */

export interface ApiKeyRow {
  id: number;
  key_hash: string;
  environment: string;
  revoked_at: number | null;
  last_used_at: number | null;
}

export interface LinkRow {
  id: number;
  slug: string;
  destination: string;
  redirect_type: number;
  /** SQLite has no boolean: 0 or 1, per the table's CHECK constraint. */
  is_active: number;
  expires_at: number | null;
  /** Tombstone (D15); every read path filters this IS NULL. */
  deleted_at: number | null;
  external_id: string | null;
  click_count: number;
  last_clicked_at: number | null;
  created_by_key_id: number;
  created_at: number;
  updated_at: number;
}
