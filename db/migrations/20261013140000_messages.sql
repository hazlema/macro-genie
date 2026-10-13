-- Messages sent with the contact form, read in Admin → Inbox.
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id BIGINT REFERENCES accounts (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done'))
);
CREATE INDEX messages_status ON messages (status, id DESC);
