import { test } from "node:test";
import assert from "node:assert/strict";
import raw from "../foods.json" with { type: "json" };
import { findFoods, normalizeDataset } from "../src/lib/foods.js";
import {
  UserFacingError,
  findFoodsResult,
  generateIdea,
  methodPrompt,
} from "../server/chef.js";
import handler from "../netlify/functions/idea.js";

const { foods } = normalizeDataset(raw);
const pick = (q) => findFoods(foods, q)[0];
const pumpkin = pick("pumpkin canned without salt");
const gruyere = pick("cheese gruyere");
const mushroom = pick("mushrooms white raw");
const base = {
  servings: 4,
  ranges: { netCarbs: { max: 5 }, calories: { max: 600 } },
  want: ["pumpkin", "onions", "mushrooms"],
  note: "comfort food",
  dislikes: ["mushrooms"],
  angle: 0,
};

// A stand-in for the Anthropic client that replays scripted turns.
function fakeApi(turns) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(structuredClone(params));
          return turns[calls.length - 1];
        },
      },
    },
  };
}
const toolUse = (id, name, input) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});

test("an idea is searched, checked against dislikes, and sized by the solver", async () => {
  const api = fakeApi([
    toolUse("t1", "find_foods", { queries: ["cheese gruyere", "mushrooms"] }),
    toolUse("t2", "submit_idea", {
      name: "Pumpkin gratin",
      description: "Silky and savory.",
      ingredients: [
        { id: pumpkin.id, grams: 300, required: false },
        { id: gruyere.id, grams: 120, required: false },
        { id: mushroom.id, grams: 100, required: false },
      ],
      seasonings: ["sage", "nutmeg", "fresh mushrooms"],
    }),
  ]);
  const idea = await generateIdea(base, api);
  assert.deepEqual(idea.seasonings, ["sage", "nutmeg"]);

  const first = api.calls[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.fallbacks, "default");
  assert.match(first.messages[0].content, /comfort food/);
  assert.match(
    first.messages[0].content,
    /Foods they want in it: pumpkin, onions\n/,
    "a wanted food that's also disliked is not requested",
  );
  assert.match(first.messages[0].content, /Net carbs: at most 5 g/);
  const results = api.calls[1].messages.at(-1).content[0].content;
  assert.match(results, new RegExp(gruyere.id));
  assert.doesNotMatch(results, /Mushrooms, white/, "dislikes never offered");

  assert.equal(idea.name, "Pumpkin gratin");
  assert.deepEqual(
    idea.ingredients.map((i) => i.id).sort(),
    [gruyere.id, pumpkin.id].sort(),
    "disliked foods dropped",
  );
  assert.equal(
    idea.ingredients.find((i) => i.id === pumpkin.id).required,
    true,
    "asked-for foods must stay in",
  );
  assert.deepEqual(idea.missing, ["onions"]);
  assert.equal(idea.fits, true);
  assert.ok(idea.perServing.netCarbs <= 5.05);
});

test("a model that stops without submitting is nudged once more", async () => {
  const api = fakeApi([
    { stop_reason: "end_turn", content: [{ type: "text", text: "Hmm." }] },
    toolUse("t1", "submit_idea", {
      name: "Plain pumpkin",
      description: "",
      ingredients: [{ id: pumpkin.id, grams: 200, required: true }],
      seasonings: [],
    }),
  ]);
  const idea = await generateIdea({ ...base, want: [] }, api);
  assert.equal(idea.ingredients[0].id, pumpkin.id);
  assert.match(api.calls[1].messages.at(-1).content, /submit_idea/);
});

test("refusals and bad requests become clear errors", async () => {
  await assert.rejects(
    generateIdea(base, fakeApi([{ stop_reason: "refusal", content: [] }])),
    (e) => e instanceof UserFacingError && e.status === 422,
  );
  await assert.rejects(generateIdea({ ...base, angle: 9 }, fakeApi([])));
  await assert.rejects(generateIdea({ ...base, extra: 1 }, fakeApi([])));
});

test("food search falls back to fewer words and respects dislikes", () => {
  const text = findFoodsResult(["pumpkin canned zzzz", "qqqq"], ["pie"]);
  assert.match(text, /Pumpkin, canned/);
  assert.doesNotMatch(text, /pie mix/i);
  assert.match(text, /"qqqq":\nno matches/);
});

test("the method prompt fixes the amounts and lists the macros", () => {
  const prompt = methodPrompt({
    name: "Gratin",
    description: "",
    servings: 2,
    ingredients: [{ id: gruyere.id, grams: 100 }],
    seasonings: ["thyme"],
    dislikes: ["cilantro"],
  });
  assert.match(prompt, /- 100 g Cheese, gruyere/);
  assert.match(prompt, /Never use: cilantro/);
  assert.match(prompt, /protein/);
});

test("without an API key the endpoint says so instead of failing vaguely", async () => {
  const saved = {
    key: process.env.ANTHROPIC_API_KEY,
    url: process.env.ANTHROPIC_BASE_URL,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  try {
    const res = await handler(
      new Request("https://example.com/api/idea", {
        method: "POST",
        body: JSON.stringify(base),
      }),
    );
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
    const bad = await handler(
      new Request("https://example.com/api/idea", {
        method: "POST",
        body: "{",
      }),
    );
    assert.equal(bad.status, 400);
  } finally {
    if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.url !== undefined) process.env.ANTHROPIC_BASE_URL = saved.url;
  }
});

test("API errors map to messages a visitor or site owner can act on", async () => {
  const { fail } = await import("../server/http.js");
  const original = console.error;
  console.error = () => {};
  try {
    const rejected = fail(Object.assign(new Error("bad key"), { status: 401 }));
    assert.equal(rejected.status, 503);
    assert.match((await rejected.json()).error, /API key was rejected/);
    assert.equal(fail({ status: 429 }).status, 429);
    assert.equal(fail(new Error("boom")).status, 502);
  } finally {
    console.error = original;
  }
});

test("idea cost is logged per job and the model follows IDEA_MODEL", async () => {
  const logged = [];
  const original = console.log;
  console.log = (line) => logged.push(JSON.parse(line));
  const saved = process.env.IDEA_MODEL;
  try {
    const submit = toolUse("t1", "submit_idea", {
      name: "Plain pumpkin",
      description: "",
      ingredients: [{ id: pumpkin.id, grams: 200, required: true }],
      seasonings: [],
    });
    const search = toolUse("t0", "find_foods", { queries: ["pumpkin"] });
    search.usage = { input_tokens: 1000, output_tokens: 200 };
    submit.usage = { input_tokens: 3000, output_tokens: 300 };
    submit.model = "claude-sonnet-5-5";

    process.env.IDEA_MODEL = "claude-sonnet-5-5";
    const api = fakeApi([search, submit]);
    const idea = await generateIdea(base, api);
    assert.equal(api.calls[0].model, "claude-sonnet-5-5");
    // 4000 input at $2/M + 500 output at $10/M = $0.013
    assert.deepEqual(idea.usage, {
      model: "claude-sonnet-5-5",
      costUsd: 0.013,
    });
    assert.equal(logged.at(-1).event, "ai_usage");
    assert.equal(logged.at(-1).calls, 2);

    process.env.IDEA_MODEL = "claude-haiku-5-5";
    const haiku = fakeApi([submit]);
    await generateIdea(base, haiku);
    assert.equal(haiku.calls[0].model, "claude-haiku-5-5");
    assert.equal(haiku.calls[0].fallbacks, undefined, "Haiku has no fallback");

    process.env.IDEA_MODEL = "gpt-whatever";
    const other = fakeApi([submit]);
    await generateIdea(base, other);
    assert.equal(other.calls[0].model, "claude-opus-5-5");
  } finally {
    console.log = original;
    if (saved === undefined) delete process.env.IDEA_MODEL;
    else process.env.IDEA_MODEL = saved;
  }
});

test("guessed ids are sent back for a retry; food names resolve as a last resort", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    // Search and submit in the same turn, with an id the model made up.
    const both = {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "s",
          name: "find_foods",
          input: { queries: ["pumpkin"] },
        },
        {
          type: "tool_use",
          id: "x",
          name: "submit_idea",
          input: {
            name: "Guess",
            description: "",
            ingredients: [
              { id: "usda-row-123456789", grams: 200, required: true },
            ],
            seasonings: [],
          },
        },
      ],
    };
    const fixed = toolUse("y", "submit_idea", {
      name: "Pumpkin bake",
      description: "",
      ingredients: [{ id: pumpkin.id, grams: 200, required: true }],
      seasonings: [],
    });
    const api = fakeApi([both, fixed]);
    const idea = await generateIdea(base, api);
    assert.equal(idea.name, "Pumpkin bake");
    const replies = api.calls[1].messages.at(-1).content;
    assert.match(replies.find((r) => r.tool_use_id === "s").content, /Pumpkin/);
    const rejected = replies.find((r) => r.tool_use_id === "x");
    assert.equal(rejected.is_error, true);
    assert.match(rejected.content, /usda-row-123456789 is not an id/);

    // On the last turn, a name written in place of an id is looked up.
    const names = toolUse("z", "submit_idea", {
      name: "Cheese plate",
      description: "",
      ingredients: [{ id: "cheese gruyere", grams: 100, required: false }],
      seasonings: [],
    });
    const stubborn = fakeApi([names, names, names, names]);
    const last = await generateIdea({ ...base, want: [] }, stubborn);
    assert.equal(stubborn.calls.length, 4);
    assert.equal(last.ingredients[0].id, gruyere.id);
  } finally {
    console.log = quiet;
  }
});
