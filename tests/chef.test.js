import { test } from "node:test";
import assert from "node:assert/strict";
import raw from "../foods.json" with { type: "json" };
import { findFoods, normalizeDataset } from "../src/lib/foods.js";
import {
  UserFacingError,
  findFoodsResult,
  generateIdea,
  buildRecipe,
  recipePrompt,
  writeRecipe,
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
    "only the chosen foods",
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

test("a written recipe keeps the request's foods and grams, whatever the model says", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const request = {
      name: "Gratin with Feta",
      description: "Salty feta on top.",
      servings: 2,
      ingredients: [
        { id: pumpkin.id, grams: 230 },
        { id: gruyere.id, grams: 100 },
      ],
      seasonings: ["thyme"],
      dislikes: ["cilantro"],
    };
    const api = fakeApi([
      toolUse("r", "submit_recipe", {
        name: "Pumpkin Gruyère Gratin",
        description: "Nutty Gruyère over silky pumpkin.",
        ingredients: [
          { n: 1, label: "canned pumpkin", qty: 1, unit: "cup", prep: "" },
          { n: 2, label: "Gruyère", qty: 0, unit: "g", prep: "shredded" },
          { n: 9, label: "made-up food", qty: 5, unit: "cup", prep: "" },
        ],
        seasonings: ["thyme", "fresh cilantro"],
        steps: [
          "1. Heat the oven to 375°F.",
          "Mix {1} pumpkin with {2:3/4} Gruyère.",
          "  ",
        ],
        tip: "Brown it well.",
      }),
    ]);
    const recipe = await writeRecipe(request, api);
    const prompt = api.calls[0].messages[0].content;
    assert.match(
      prompt,
      /1\. 230 g Pumpkin, canned, without salt\n2\. 100 g Cheese, gruyere/,
    );
    assert.match(prompt, /Never use: cilantro/);
    assert.equal(api.calls[0].tools[0].name, "submit_recipe");

    assert.equal(recipe.version, 2);
    assert.equal(
      recipe.name,
      "Pumpkin Gruyère Gratin",
      "renamed after the swap",
    );
    assert.equal(recipe.servings, 2);
    assert.deepEqual(
      recipe.ingredients.map((i) => [i.id, i.grams, i.qty, i.unit]),
      [
        [pumpkin.id, 230, 1, "cup"],
        [gruyere.id, 100, null, ""],
      ],
    );
    assert.deepEqual(
      recipe.seasonings,
      ["thyme"],
      "disliked seasoning dropped",
    );
    assert.deepEqual(recipe.steps, [
      "Heat the oven to 375°F.",
      "Mix {1} pumpkin with {2:3/4} Gruyère.",
    ]);
    assert.ok(recipe.perServing.protein > 0 && recipe.gramsPerServing === 165);
  } finally {
    console.log = quiet;
  }
});

test("a recipe without steps is asked for again, then fails clearly", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const empty = toolUse("r", "submit_recipe", {
      name: "x",
      description: "",
      ingredients: [],
      seasonings: [],
      steps: [],
      tip: "",
    });
    const request = {
      name: "Gratin",
      servings: 2,
      ingredients: [{ id: pumpkin.id, grams: 230 }],
    };
    const api = fakeApi([empty, empty]);
    await assert.rejects(
      writeRecipe(request, api),
      /didn't come back complete/,
    );
    assert.equal(api.calls.length, 2);
    assert.equal(api.calls[1].messages.at(-1).content[0].is_error, true);
  } finally {
    console.log = quiet;
  }
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

test("problem ideas go back for a retry; copied id lines and names still resolve", async () => {
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
    assert.match(rejected.content, /"usda-row-123456789" is not an id/);

    // A whole result line copied as the id, or a food name, still works.
    const copied = toolUse("c", "submit_idea", {
      name: "Copied",
      description: "",
      ingredients: [
        {
          id: `${pumpkin.id} | Pumpkin, canned, without salt`,
          grams: 200,
          required: true,
        },
        { id: "cheese gruyere", grams: 60, required: false },
      ],
      seasonings: [],
    });
    const once = fakeApi([copied]);
    const accepted = await generateIdea(base, once);
    assert.equal(once.calls.length, 1);
    assert.deepEqual(
      accepted.ingredients.map((i) => i.id).sort(),
      [gruyere.id, pumpkin.id].sort(),
    );

    // An empty or disliked-only idea is retried, then fails clearly.
    const empty = toolUse("e", "submit_idea", {
      name: "Nothing",
      description: "",
      ingredients: [{ id: mushroom.id, grams: 100, required: false }],
      seasonings: [],
    });
    const stubborn = fakeApi([empty, empty, empty, empty, empty]);
    await assert.rejects(generateIdea(base, stubborn), /too many steps/);
    assert.equal(stubborn.calls.length, 5);
    assert.match(
      stubborn.calls[1].messages.at(-1).content[0].content,
      /won't eat/,
    );
  } finally {
    console.log = quiet;
  }
});

test("Claude's note of which request an ingredient answers counts toward it", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const submit = toolUse("t", "submit_idea", {
      name: "Smash bowl",
      description: "",
      ingredients: [
        {
          id: gruyere.id,
          grams: 80,
          required: false,
          fulfills: "cheese please",
        },
        { id: pumpkin.id, grams: 200, required: false, fulfills: "Pumpkin" },
      ],
      seasonings: [],
    });
    const idea = await generateIdea(
      { ...base, want: ["pumpkin", "cheese please", "onions"], dislikes: [] },
      fakeApi([submit]),
    );
    assert.deepEqual(idea.missing, ["onions"]);
    const byId = Object.fromEntries(idea.ingredients.map((i) => [i.id, i]));
    assert.equal(byId[pumpkin.id].fulfills, "pumpkin");
    assert.equal(byId[pumpkin.id].required, true);
    assert.equal(byId[gruyere.id].fulfills, "cheese please");
  } finally {
    console.log = quiet;
  }
});

test("each model call gets the time left, and timeouts read as 'took too long'", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const options = [];
    const api = {
      beta: {
        messages: {
          create: async (params, opts) => {
            options.push(opts);
            return toolUse("t", "submit_idea", {
              name: "Quick",
              description: "",
              ingredients: [{ id: pumpkin.id, grams: 200, required: true }],
              seasonings: [],
            });
          },
        },
      },
    };
    await generateIdea(base, api);
    assert.ok(options[0].timeout > 45_000 && options[0].timeout <= 50_000);

    const { fail } = await import("../server/http.js");
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const res = fail(new Anthropic.APIConnectionTimeoutError());
    assert.equal(res.status, 504);
    assert.match((await res.json()).error, /took too long/);
  } finally {
    console.log = quiet;
  }
});

test("local dev uses only the .env key, straight to Anthropic, never the gateway", async () => {
  const { client } = await import("../server/chef.js");
  const saved = { ...process.env };
  try {
    process.env.MACRO_GENIE_LOCAL = "1";
    process.env.ANTHROPIC_API_KEY = "gateway-token";
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example";
    process.env.MACRO_GENIE_LOCAL_KEY = "";
    assert.throws(() => client(), /AI is off locally/);
    process.env.MACRO_GENIE_LOCAL_KEY = "sk-ant-local";
    const api = client();
    assert.equal(api.apiKey, "sk-ant-local");
    assert.equal(api.baseURL, "https://api.anthropic.com");
  } finally {
    for (const key of [
      "MACRO_GENIE_LOCAL",
      "MACRO_GENIE_LOCAL_KEY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
    ])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("each idea carries an honest pairing rating; there are four variations", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const submit = (pairing, note) =>
      toolUse("t", "submit_idea", {
        name: "Strawberry Pumpkin Bake",
        description: "",
        ingredients: [{ id: pumpkin.id, grams: 200, required: true }],
        seasonings: [],
        pairing,
        pairing_note: note,
      });
    const clash = await generateIdea(
      base,
      fakeApi([
        submit("clashes", "  Strawberries and   pumpkin rarely share a dish. "),
      ]),
    );
    assert.equal(clash.pairing, "clashes");
    assert.equal(
      clash.pairingNote,
      "Strawberries and pumpkin rarely share a dish.",
    );
    const odd = await generateIdea(base, fakeApi([submit("amazing", "")]));
    assert.equal(odd.pairing, null, "unknown ratings aren't shown");

    const api = fakeApi([submit("great", "")]);
    await generateIdea(base, api);
    const tool = api.calls[0].tools.find((t) => t.name === "submit_idea");
    assert.deepEqual(tool.input_schema.properties.pairing.enum, [
      "great",
      "mixed",
      "clashes",
    ]);
    assert.match(api.calls[0].system, /Rate the pairing honestly/);

    await assert.rejects(generateIdea({ ...base, angle: 4 }, fakeApi([])));
    await generateIdea({ ...base, angle: 3 }, fakeApi([submit("great", "")]));
  } finally {
    console.log = quiet;
  }
});

test("written recipes get their kitchen measures checked against real weights", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const apple = findFoods(foods, "apples granny smith")[0];
    const recipe = await writeRecipe(
      {
        name: "Apple bake",
        servings: 1,
        ingredients: [
          { id: apple.id, grams: 35 },
          { id: pumpkin.id, grams: 230 },
        ],
      },
      fakeApi([
        toolUse("r", "submit_recipe", {
          name: "Apple bake",
          description: "",
          ingredients: [
            {
              n: 1,
              label: "Granny Smith apple",
              qty: 0.5,
              unit: "Granny Smith apple",
              prep: "sliced",
            },
            { n: 2, label: "canned pumpkin", qty: 3, unit: "cup", prep: "" },
          ],
          seasonings: [],
          steps: ["Bake {1} apple with {2} pumpkin."],
          tip: "",
        }),
      ]),
    );
    assert.deepEqual(
      recipe.ingredients.map((i) => [i.qty, i.unit]),
      [
        [null, ""],
        [0.94, "cup"],
      ],
    );
  } finally {
    console.log = quiet;
  }
});
