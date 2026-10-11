-- Community: posted recipes, likes, comments, and reports, plus moderation
-- state. A post keeps the structured recipe and its per-serving numbers
-- (recomputed by the server from USDA data, never taken from the browser)
-- so the list can be filtered by the same macro ranges as the Foods tab.

ALTER TABLE accounts ADD COLUMN banned BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  recipe JSONB NOT NULL,
  name TEXT NOT NULL,
  meal_type TEXT NOT NULL
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'dessert')),
  calories REAL NOT NULL,
  protein REAL NOT NULL,
  net_carbs REAL NOT NULL,
  fat REAL NOT NULL,
  sugar REAL NOT NULL,
  sodium REAL NOT NULL,
  -- live: shown; held: waiting for review; blocked: refused by moderation
  -- (kept for review); removed: taken down by its poster or a moderator.
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('live', 'held', 'blocked', 'removed')),
  moderation_note TEXT NOT NULL DEFAULT '',
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX posts_browse ON posts (status, meal_type, created_at DESC);
CREATE INDEX posts_by_account ON posts (account_id);

CREATE TABLE post_likes (
  post_id BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, account_id)
);

CREATE TABLE comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('live', 'held', 'blocked', 'removed')),
  moderation_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_on_post ON comments (post_id, created_at);

-- One report per person per item; enough reports hide the item for review.
CREATE TABLE reports (
  id BIGSERIAL PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, account_id)
);
