-- The seeded "Recipe blogger" template named one blog ("Real Balanced") where
-- it meant a blank, so every invite said it. Make it [blog name], which
-- picking "Person (Site)" from the address book fills.
UPDATE invite_templates
SET body = replace(body, 'I''ve been browsing Real Balanced.', 'I''ve been browsing [blog name].'),
    updated_at = now()
WHERE body LIKE '%I''ve been browsing Real Balanced.%';
