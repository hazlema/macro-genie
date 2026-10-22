-- The invite address book's people, imported from a JSON list in Admin →
-- Invites: who to invite next. Joined to invites by email (any case); like
-- invites, nothing here points at an account.
CREATE TABLE invite_contacts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invite_contacts_email ON invite_contacts (lower(email));
CREATE INDEX invites_email ON invites (lower(email));
