-- Invites the owner emails from Admin → Invites. Each carries a one-time code
-- worth some credits, redeemed on /redeem. No column names the account that
-- redeemed it, on purpose: the address book never links an email to a user.
CREATE TABLE invites (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  credits INT NOT NULL CHECK (credits BETWEEN 1 AND 500),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);
CREATE INDEX invites_sent ON invites (sent_at DESC);

-- Reusable invite emails. [credits] and [redeem link] fill themselves in;
-- any other [bracket] is a blank to fill before sending.
CREATE TABLE invite_templates (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO invite_templates (name, subject, body) VALUES (
'Recipe blogger',
'A macro tool built for food like yours',
$t$Hi [user],

I've been browsing Real Balanced. [One specific recipe you liked, e.g. "your ___ is going into my rotation"]. Your recipes are exactly the kind of food I built my tool for, so I wanted to tell you about it.

It's called Macro Genie (macro-genie.com). You give it macro targets and it does two things:

- Finds foods that fit. Instead of a search ranked by popularity, you set ranges (say, under 3 g net carbs and over 10 g protein) and it returns every food that qualifies.
- Builds meals that actually taste good. Give it your targets and some ingredients, and it comes up with dishes using flavor-pairing logic, balancing sweet, heat, savory, acid, and richness, instead of random combos that happen to hit the numbers. It even explains why each dish works. One recent result: "Sweet caramelized onion tames the chipotle heat, browned mushrooms and chicken deepen the savory broth, and sour cream plus vinegar cut the richness." Then it sizes every ingredient so each serving lands on your macros, with all the nutrition math coming from USDA data, not AI guesswork.

There's also a free MCP server. If you use an AI assistant like Claude, you can connect Macro Genie to it and run food searches and recipe sizing right in the chat, at no cost.

There's no subscription. Searching is free. The AI features run on pay-as-you-go credits, and packs start at $3. Sign-in is through Google, and the only thing we store is your username. No emails, no card numbers.

I'd like to give you [credits] credits to try it out. Once you've made an account, redeem them here:
[redeem link]

If you end up liking it, a review or a mention would be wonderful. If not, no strings at all. Enjoy the credits either way.

Thanks for all the recipes,
Matthew
Macro Genie, macro-genie.com$t$
);
