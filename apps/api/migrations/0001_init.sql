-- 0001_init — the complete v1 schema (PRD §9). Forward-only, additive-first (PRD §14).

CREATE TABLE links (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,           -- UNIQUE spans tombstones: blocks reuse (D15)
  destination   TEXT NOT NULL,
  redirect_type INTEGER NOT NULL DEFAULT 302 CHECK (redirect_type IN (301,302,307,308)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  expires_at    INTEGER,                        -- epoch ms, NULL = never
  deleted_at    INTEGER,                        -- tombstone (D15); live queries filter IS NULL
  external_id   TEXT,                           -- ≤128 chars, correlation passthrough (D19)
  click_count   INTEGER NOT NULL DEFAULT 0,
  last_clicked_at INTEGER,
  created_by_key_id INTEGER NOT NULL REFERENCES api_keys(id),  -- attribution only (D12)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_links_key_created ON links(created_by_key_id, created_at DESC);  -- serves P1 per-user scoping
CREATE INDEX idx_links_created ON links(created_at DESC);      -- owner-global listing (D12)
CREATE INDEX idx_links_external ON links(external_id);         -- ?external_id= filter (D19)

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE link_tags (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (link_id, tag_id)
);
CREATE INDEX idx_link_tags_tag ON link_tags(tag_id);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY,
  prefix       TEXT NOT NULL UNIQUE,            -- first 20 chars (D11), lookup index
  key_hash     TEXT NOT NULL,                   -- sha256 hex
  name         TEXT NOT NULL,
  environment  TEXT NOT NULL DEFAULT 'live',    -- live|test (test unused until P1 — D13)
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER,                         -- soft revoke; rows never hard-deleted (D12)
  last_used_at INTEGER
);

CREATE TABLE idempotency_keys (                  -- canonical store (D18); 24 h TTL enforced on read, expired rows purged opportunistically on insert
  key             TEXT NOT NULL,
  api_key_id      INTEGER NOT NULL,
  request_hash    TEXT NOT NULL,                 -- payload mismatch → 409 idempotency_conflict
  response_status INTEGER,
  response_body   TEXT,                          -- NULL while in-flight
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (key, api_key_id)
);
