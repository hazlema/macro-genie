-- Roles, suspension, a ban list, and the admin activity log.
ALTER TABLE accounts ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN is_mod BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN suspended_at TIMESTAMPTZ;

-- The review queue's old "ban" stopped someone posting: that's a suspension
-- now. The banned column stays until the next release, because the previous
-- deploy's functions may still read it while this one builds.
UPDATE accounts SET suspended_at = now() WHERE banned;

-- Google accounts that were deleted and banned; nothing else about them is kept.
CREATE TABLE banned_subs (
  google_sub TEXT PRIMARY KEY,
  banned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL DEFAULT ''
);

-- What the admin Log tab shows. The name is copied in so entries still read
-- right after someone renames or is deleted.
CREATE TABLE activity_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  account_id BIGINT REFERENCES accounts (id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  text TEXT NOT NULL,
  link TEXT
);
CREATE INDEX activity_log_kind ON activity_log (kind, id DESC);
CREATE INDEX activity_log_created ON activity_log (created_at);
