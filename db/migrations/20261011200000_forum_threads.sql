-- Forum threads live in the posts table as kind 'thread' on a board, so
-- replies (comments), likes, reports, and moderation work the same way for
-- threads and recipes. Recipe-only columns become optional for threads.
ALTER TABLE posts
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'recipe' CHECK (kind IN ('recipe', 'thread')),
  ADD COLUMN board TEXT CHECK (board IN ('general', 'support')),
  ADD COLUMN body TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 5000);

ALTER TABLE posts
  ALTER COLUMN recipe DROP NOT NULL,
  ALTER COLUMN meal_type DROP NOT NULL,
  ALTER COLUMN calories DROP NOT NULL,
  ALTER COLUMN protein DROP NOT NULL,
  ALTER COLUMN net_carbs DROP NOT NULL,
  ALTER COLUMN fat DROP NOT NULL,
  ALTER COLUMN sugar DROP NOT NULL,
  ALTER COLUMN sodium DROP NOT NULL;

ALTER TABLE posts ADD CONSTRAINT posts_kind_fields CHECK (
  (kind = 'recipe' AND recipe IS NOT NULL AND meal_type IS NOT NULL AND board IS NULL)
  OR (kind = 'thread' AND board IS NOT NULL AND body IS NOT NULL AND recipe IS NULL)
);

CREATE INDEX posts_boards ON posts (kind, board, status, created_at DESC);
