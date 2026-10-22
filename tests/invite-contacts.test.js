import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_LIMITS,
  addressBook,
  channelLink,
  fillName,
  parseContacts,
} from "../src/lib/invite-contacts.js";

test("parseContacts reads a plain list with the expected fields", () => {
  const { contacts, skipped } = parseContacts([
    { name: "Sam Cook", channel: "YouTube", email: "Sam@Example.com ", description: "Weeknight dinners" },
  ]);
  assert.deepEqual(contacts, [
    { email: "sam@example.com", name: "Sam Cook", channel: "YouTube", description: "Weeknight dinners" },
  ]);
  assert.deepEqual(skipped, []);
});

test("parseContacts accepts other spellings of the field names", () => {
  const { contacts } = parseContacts([
    { "Full Name": "A", Platform: "TikTok", "E-mail": "a@x.com", "Site Description": "about a" },
    { creator: "B", website: "b.com", email_address: "b@x.com", about: "about b" },
    { Name: "C", Channel_URL: "https://c.com", Contact_Email: "c@x.com", short_description: "about c" },
  ]);
  assert.deepEqual(contacts.map((c) => [c.name, c.channel, c.email, c.description]), [
    ["A", "TikTok", "a@x.com", "about a"],
    ["B", "b.com", "b@x.com", "about b"],
    ["C", "https://c.com", "c@x.com", "about c"],
  ]);
});

test("parseContacts finds the list inside a wrapper object", () => {
  assert.equal(parseContacts({ generated: "today", creators: [{ email: "a@x.com" }] }).contacts.length, 1);
  assert.equal(parseContacts({ email: "solo@x.com", name: "Solo" }).contacts.length, 1);
});

test("parseContacts skips bad emails and repeats, saying which row", () => {
  const { contacts, skipped } = parseContacts([
    { name: "Ok", email: "ok@x.com" },
    { name: "No email" },
    { name: "Bad", email: "not an email" },
    { name: "Again", email: "OK@x.com" },
    "just text",
  ]);
  assert.deepEqual(contacts.map((c) => c.email), ["ok@x.com"]);
  assert.deepEqual(skipped, [
    { row: 2, label: "No email", reason: "no email" },
    { row: 3, label: "Bad", reason: "email doesn't look right" },
    { row: 4, label: "Again", reason: "listed twice" },
    { row: 5, label: "", reason: "not a person" },
  ]);
});

test("parseContacts trims long fields and refuses what isn't a list", () => {
  const { contacts } = parseContacts([{ email: "a@x.com", description: "x".repeat(5000) }]);
  assert.equal(contacts[0].description.length, CONTACT_LIMITS.description);
  assert.throws(() => parseContacts("hello"), /list of people/);
  assert.throws(() => parseContacts({ note: "nothing" }), /list of people/);
  assert.throws(
    () => parseContacts(Array.from({ length: CONTACT_LIMITS.rows + 1 }, (_, i) => ({ email: `p${i}@x.com` }))),
    /at most/,
  );
});

test("fillName fills [user] and [name], and leaves them when there's no name", () => {
  assert.equal(fillName("Hi [user], [ Name ]! [other]", "Sam"), "Hi Sam, Sam! [other]");
  assert.equal(fillName("Hi [user],", ""), "Hi [user],");
});

test("fillName splits \"Person (Site)\": the person for [user], the site for [blog name]", () => {
  const text = "Hi [user], I've been browsing [Blog Name]. [site] / [channel name]";
  assert.equal(fillName(text, "Ian (Haste's Kitchen)"), "Hi Ian, I've been browsing Haste's Kitchen. Haste's Kitchen / Haste's Kitchen");
  assert.equal(fillName(text, "Sam Cook"), "Hi Sam Cook, I've been browsing [Blog Name]. [site] / [channel name]");
  assert.equal(fillName("Hi [user]", "(Just A Site)"), "Hi [user]");
});

test("channelLink links web addresses only", () => {
  assert.equal(channelLink("https://pinchofyum.com"), "https://pinchofyum.com/");
  assert.equal(channelLink("youtube.com/@sam"), "https://youtube.com/@sam");
  assert.equal(channelLink("YouTube"), null);
  assert.equal(channelLink("javascript:alert(1)"), null);
  assert.equal(channelLink(""), null);
});

test("addressBook joins people to their invites by email", () => {
  const contacts = [
    { id: 1, email: "a@x.com", name: "A", channel: "", description: "" },
    { id: 2, email: "b@x.com", name: "B", channel: "", description: "" },
    { id: 3, email: "c@x.com", name: "C", channel: "", description: "" },
  ];
  const invites = [
    { id: 10, email: "B@x.com", credits: 50, sentAt: "2026-10-22T10:00:00Z", usedAt: null, canceledAt: null },
    { id: 11, email: "old@x.com", credits: 20, sentAt: "2026-10-21T10:00:00Z", usedAt: "2026-10-21T00:00:00Z", canceledAt: null },
    { id: 12, email: "new@x.com", credits: 20, sentAt: "2026-10-22T12:00:00Z", usedAt: null, canceledAt: "2026-10-22T13:00:00Z" },
  ];
  const book = addressBook(contacts, invites);
  // Not invited yet first, in the order they were imported; then the rest,
  // most recently sent first.
  assert.deepEqual(book.map((p) => [p.email, p.status]), [
    ["a@x.com", "new"],
    ["c@x.com", "new"],
    ["new@x.com", "canceled"],
    ["b@x.com", "invited"],
    ["old@x.com", "used"],
  ]);
  const b = book.find((p) => p.email === "b@x.com");
  assert.equal(b.name, "B");
  assert.equal(b.contactId, 2);
  assert.equal(b.invite.id, 10);
  assert.equal(book.find((p) => p.email === "old@x.com").contactId, null);
});

test("addressBook: a used code counts even after a newer invite", () => {
  const book = addressBook([], [
    { id: 2, email: "a@x.com", credits: 5, sentAt: "2026-10-22T10:00:00Z", usedAt: null, canceledAt: null },
    { id: 1, email: "a@x.com", credits: 5, sentAt: "2026-10-21T10:00:00Z", usedAt: "2026-10-21T00:00:00Z", canceledAt: null },
  ]);
  assert.equal(book.length, 1);
  assert.equal(book[0].status, "used");
  assert.equal(book[0].usedAt, "2026-10-21T00:00:00Z");
  assert.equal(book[0].invite.id, 2, "the latest invite is the one Resend and Cancel act on");
});
