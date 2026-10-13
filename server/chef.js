// Server-only: asks Claude for dish ideas and recipe methods. Claude picks
// foods and rough amounts; the numbers always come from the USDA data and the
// solver, never from the model.
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, addUsage, emptyUsage, logUsage } from "./usage.js";
import { measure } from "./timing.js";
import { checkMeasure } from "../src/lib/measures.js";
import { z } from "zod";
import raw from "../foods.json" with { type: "json" };
import {
  NUTRIENTS,
  findFoods,
  formatAmount,
  normalizeDataset,
} from "../src/lib/foods.js";
import {
  expandDislikes,
  isDisliked,
  answersRequest,
  missingRequests,
  solveRecipe,
  usdaNamesFor,
} from "../src/lib/recipe.js";

// Which model writes ideas and recipes. Set IDEA_MODEL / RECIPE_MODEL in
// Netlify to switch; anything not in the price list falls back to Opus.
const pick = (name) =>
  MODELS.includes(process.env[name]) ? process.env[name] : "claude-opus-5-5";
export const ideaModel = () => pick("IDEA_MODEL");
export const recipeModel = () => pick("RECIPE_MODEL");
const { foods } = normalizeDataset(raw);
const byId = new Map(foods.map((f) => [f.id, f]));
export const foodById = (id) => byId.get(id) ?? null;

// Each of the four parallel requests leans a different way so the ideas differ.
export const ANGLES = [
  "a bake, casserole, or gratin",
  "a skillet, stir-fry, or sauté",
  "a soup, stew, or curry",
  "something from a cuisine people might not expect",
];

const range = z
  .object({
    min: z.number().nonnegative().nullish(),
    max: z.number().nonnegative().nullish(),
  })
  .strict();
const ranges = z
  .object(Object.fromEntries(NUTRIENTS.map((n) => [n.key, range.optional()])))
  .strict()
  .default({});
const dislikes = z.array(z.string().trim().min(1).max(40)).max(50).default([]);

export const ideaRequest = z
  .object({
    servings: z.number().int().min(1).max(50),
    ranges,
    want: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    note: z.string().trim().max(300).default(""),
    dislikes,
    angle: z
      .number()
      .int()
      .min(0)
      .max(ANGLES.length - 1),
  })
  .strict();

export const methodRequest = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(400).default(""),
    servings: z.number().int().min(1).max(50),
    ingredients: z
      .array(
        z
          .object({
            id: z.string().max(40),
            grams: z.number().positive().max(5000),
          })
          .strict(),
      )
      .min(1)
      .max(15),
    seasonings: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    dislikes,
  })
  .strict();

export class UserFacingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const SYSTEM = `You design dishes for Macro Genie, a site where people find food by nutrition numbers. A person gives you per-serving nutrition targets, foods they want in the dish, and foods they won't eat. You propose one dish.

How to work:
1. Call find_foods once with every ingredient you are considering. The food data is USDA SR Legacy, so search with plain words in its style: "pumpkin canned", "cheese gruyere", "chicken thigh roasted", "cream heavy whipping", "egg whole raw".
2. Choose ingredients from the results by id. Give grams for the whole dish, not per serving.
3. After you have the find_foods results, call submit_idea with the dish. That is your final answer. Never guess ids: only use ids that find_foods returned.

Rules:
- Include every food the person asked for as an ingredient. Search for each one and pick the plainest match (for "eggs": "Egg, whole, raw, fresh"). Set fulfills on that ingredient to the food as they wrote it.
- Never use a food they won't eat, or anything containing it.
- Prefer plain, unprocessed entries. Watch for hidden carbs and sugar: pie mixes, breaded or battered items, sweetened products, sauces.
- Seasonings are for things with negligible calories only: salt, pepper, dried or fresh herbs, spices, garlic, vinegar, citrus zest, water. Everything with real calories must be an ingredient from find_foods.
- Aim for amounts that roughly fit the targets. The site adjusts the grams afterwards to hit the numbers exactly, so don't do precise arithmetic.
- It must taste great. Think about fat, acid, salt, texture, and browning.
- Name the dish the way a good menu would. The description is one sentence a hungry person would want to read.
- Rate the pairing honestly, as a chef would, not to please them: "great" when cooks would recognize these flavors, seasons, and textures together; "mixed" when some parts are unusual but can work (say how); "clashes" when these foods rarely belong in one dish (for example summer fruit with fall squash). If the clash comes from foods they asked for, still rate it and name those foods.`;

const TOOLS = [
  {
    name: "find_foods",
    description:
      "Search the USDA food data. Returns, for each query, matching foods with their id and nutrition per 100 g.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: "One short search per ingredient, at most 12",
        },
      },
      required: ["queries"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_idea",
    description: "Submit the finished dish idea.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Food id from find_foods" },
              grams: {
                type: "number",
                description: "Grams in the whole dish",
              },
              required: {
                type: "boolean",
                description:
                  "True if the dish doesn't work without a good amount of it",
              },
              fulfills: {
                type: "string",
                description:
                  'Which requested food this is, written exactly as they asked (e.g. "strawberry" for Strawberries, raw), or "" if none',
              },
            },
            required: ["id", "grams", "required", "fulfills"],
            additionalProperties: false,
          },
        },
        seasonings: { type: "array", items: { type: "string" } },
        pairing: {
          type: "string",
          enum: ["great", "mixed", "clashes"],
          description:
            "How well these ingredients go together as one dish, judged honestly",
        },
        pairing_note: {
          type: "string",
          description:
            "One short sentence on why; for mixed or clashes, name the foods that fight",
        },
      },
      required: [
        "name",
        "description",
        "ingredients",
        "seasonings",
        "pairing",
        "pairing_note",
      ],
      additionalProperties: false,
    },
  },
];

const describeFood = (food) => {
  const n = food.per100g;
  return `${food.id} | ${food.name} | per 100 g: ${formatAmount(n.calories)} kcal, ${formatAmount(n.protein)} g protein, ${formatAmount(n.netCarbs)} g net carbs, ${formatAmount(n.fat)} g fat`;
};

export function findFoodsResult(queries, dislikeWords) {
  const exclude = expandDislikes(dislikeWords);
  return queries
    .slice(0, 12)
    .map((query) => {
      // Everyday names first ("hamburger" -> "beef, ground"), then the query
      // itself, dropping trailing words until something matches.
      let matches = usdaNamesFor(String(query)).flatMap((name) =>
        findFoods(foods, name, { exclude, limit: 10 }),
      );
      let words = String(query).trim().split(/\s+/).slice(0, 6);
      let direct = [];
      while (words.length && !direct.length) {
        direct = findFoods(foods, words.join(" "), { exclude, limit: 10 });
        if (!direct.length) words = words.slice(0, -1);
      }
      matches = [
        ...new Map([...matches, ...direct].map((f) => [f.id, f])).values(),
      ].slice(0, 10);
      return `"${query}":\n${matches.length ? matches.map(describeFood).join("\n") : "no matches"}`;
    })
    .join("\n\n");
}

function targetsText(request) {
  const lines = NUTRIENTS.flatMap(({ key, label, unit }) => {
    const r = request.ranges[key];
    if (!r || (r.min == null && r.max == null)) return [];
    const parts = [];
    if (r.min != null) parts.push(`at least ${r.min} ${unit}`);
    if (r.max != null) parts.push(`at most ${r.max} ${unit}`);
    return [`- ${label}: ${parts.join(", ")}`];
  });
  return lines.length ? lines.join("\n") : "- No targets set";
}

export function ideaPrompt(request) {
  return [
    `Servings: ${request.servings}`,
    `Targets per serving:\n${targetsText(request)}`,
    `Foods they want in it: ${wanted(request).join(", ") || "none named; surprise them"}`,
    `Foods they won't eat: ${request.dislikes.length ? request.dislikes.join(", ") : "none"}`,
    request.note ? `Their note: ${request.note}` : "",
    `Variation: lean towards ${ANGLES[request.angle]}, unless that clashes with their note or foods.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// An ingredient id from find_foods. As a last resort, a model that wrote a
// food name instead of an id gets the best match for that name.
function resolveFood(ref, dislikes) {
  const key = String(ref ?? "").trim();
  // Models sometimes copy more than the id: "usda-row-7811 | Pumpkin, …".
  const id = key.match(/usda-row-\d+/)?.[0];
  if (id) return byId.get(id) ?? null;
  if (key.length < 3) return null;
  return (
    findFoods(foods, key, { exclude: expandDislikes(dislikes), limit: 1 })[0] ??
    null
  );
}

// What's wrong with a submitted idea, in words the model can act on.
export function reviewSubmission(submission, request) {
  const problems = [];
  const ingredients = Array.isArray(submission?.ingredients)
    ? submission.ingredients
    : [];
  if (!ingredients.length) problems.push("The ingredients list is empty.");
  let usable = 0;
  for (const ingredient of ingredients) {
    const food = resolveFood(ingredient?.id, request.dislikes);
    if (!food)
      problems.push(
        `"${String(ingredient?.id).slice(0, 60)}" is not an id from find_foods.`,
      );
    else if (isDisliked(food, request.dislikes))
      problems.push(`${food.name} is a food they won't eat.`);
    else if (!(Number(ingredient.grams) > 0))
      problems.push(`${food.name} needs grams greater than 0.`);
    else usable++;
  }
  return { problems, usable };
}

// The foods asked for, minus any that are also on the dislike list.
const wanted = (request) =>
  request.want.filter((w) => !isDisliked({ name: w }, request.dislikes));

// Check Claude's submission against the data and the person's rules, then
// size the amounts with the solver.
export function finishIdea(submission, request) {
  const asked = wanted(request);
  const seen = new Set();
  const items = [];
  for (const ingredient of submission.ingredients ?? []) {
    const food = resolveFood(ingredient.id, request.dislikes);
    const grams = Number(ingredient.grams);
    if (!food || seen.has(food.id) || !(grams > 0)) continue;
    if (isDisliked(food, request.dislikes)) continue;
    seen.add(food.id);
    // Claude's own note of which requested food this is ("strawberry" for
    // "Strawberries, raw"), kept only if it names something they asked for.
    const note = String(ingredient.fulfills ?? "")
      .trim()
      .slice(0, 40);
    const fulfills =
      asked.find(
        (w) =>
          note &&
          (w === note.toLocaleLowerCase() || answersRequest({ name: note }, w)),
      ) ?? "";
    items.push({
      food,
      grams: Math.min(Math.round(grams), 5000),
      fulfills,
      // Foods the person asked for must stay in the dish.
      required:
        !!ingredient.required ||
        !!fulfills ||
        asked.some((w) => answersRequest(food, w)),
    });
  }
  if (!items.length)
    throw new UserFacingError("This idea came back without usable foods.", 502);
  const seasonings = (submission.seasonings ?? [])
    .map((s) => String(s).slice(0, 60))
    .filter((s) => !isDisliked({ name: s }, request.dislikes))
    .slice(0, 10);
  // Asked-for foods the idea doesn't use, so the card can say so.
  const missing = missingRequests(
    [
      ...items.map((i) => i.food.name),
      ...items.map((i) => i.fulfills).filter(Boolean),
      ...seasonings,
    ],
    asked,
  );
  const solved = solveRecipe(items, {
    servings: request.servings,
    ranges: request.ranges,
  });
  return {
    name: String(submission.name ?? "").slice(0, 120) || "Untitled dish",
    description: String(submission.description ?? "").slice(0, 400),
    seasonings,
    missing,
    pairing: ["great", "mixed", "clashes"].includes(submission.pairing)
      ? submission.pairing
      : null,
    pairingNote: String(submission.pairing_note ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200),
    servings: request.servings,
    fits: solved.fits,
    misses: solved.misses,
    perServing: solved.perServing,
    totalGrams: solved.totalGrams,
    ingredients: solved.amounts.map((a) => ({
      id: a.food.id,
      name: a.food.name,
      suggested: a.wanted,
      grams: a.grams,
      required: a.required,
      fulfills: a.fulfills ?? "",
    })),
  };
}

export function client() {
  // Always straight to Anthropic, never Netlify's AI Gateway (slow, sometimes
  // not ready, and billed in Netlify credits). Netlify injects its own
  // ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL, so production reads
  // CLAUDE_API_KEY instead; under `npm run dev` the key comes from .env.
  const local = Boolean(process.env.MACRO_GENIE_LOCAL);
  const apiKey = local
    ? process.env.MACRO_GENIE_LOCAL_KEY
    : process.env.CLAUDE_API_KEY;
  if (!apiKey)
    throw new UserFacingError(
      local
        ? "AI is off locally: add ANTHROPIC_API_KEY to .env and restart npm run dev."
        : "Recipe ideas aren't set up yet: the site needs a CLAUDE_API_KEY.",
      503,
    );
  // One attempt that finishes inside Netlify's 60-second function limit.
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: "https://api.anthropic.com",
    timeout: 55_000,
    maxRetries: 0,
  });
}

// Haiku has no server-side fallback; the others retry a declined request on
// another model before giving up.
const request = (model, params) => ({
  model,
  ...(model.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
  output_config: { effort: "low" },
  ...params,
});

function checkStop(response) {
  if (response.stop_reason === "refusal")
    throw new UserFacingError(
      "Claude declined this request. Try different wording.",
      422,
    );
  if (response.stop_reason === "max_tokens")
    throw new UserFacingError("The idea ran too long. Try again.", 502);
}

// Each turn is one model call. Netlify stops a function at 60 seconds, so an
// idea gets 50: no new turn starts after 35, and each call gets what's left.
const MAX_TURNS = 5;
const BUDGET_MS = 50_000;
const LAST_START_MS = 35_000;

export async function generateIdea(input, api = client(), model = ideaModel()) {
  const req = ideaRequest.parse(input);
  const messages = [{ role: "user", content: ideaPrompt(req) }];
  const usage = emptyUsage(model);
  const started = Date.now();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const timeout = BUDGET_MS - (Date.now() - started);
    if (timeout < 5_000) break;
    const response = await measure("ai", () =>
      api.beta.messages.create(
        request(model, {
          max_tokens: 8000,
          system: SYSTEM,
          tools: TOOLS,
          messages,
        }),
        { timeout },
      ),
    );
    addUsage(usage, response);
    checkStop(response);
    const calls = response.content.filter((b) => b.type === "tool_use");
    const submit = calls.find((c) => c.name === "submit_idea");
    // Anything wrong with the idea (ids guessed before the search came back,
    // disliked foods, missing grams) goes back to the model to fix.
    const review = submit
      ? reviewSubmission(submit.input, req)
      : { problems: [], usable: 0 };
    const lastTurn =
      turn === MAX_TURNS - 1 || Date.now() - started > LAST_START_MS;
    if (submit && (!review.problems.length || (lastTurn && review.usable))) {
      try {
        const idea = finishIdea(submit.input, req);
        const line = logUsage("idea", usage, { ms: Date.now() - started });
        return { ...idea, usage: { model: line.model, costUsd: line.costUsd } };
      } catch (error) {
        logUsage("idea", usage, {
          ms: Date.now() - started,
          failed: error.message,
          problems: review.problems.slice(0, 8),
        });
        throw error;
      }
    }
    messages.push({ role: "assistant", content: response.content });
    if (!calls.length) {
      messages.push({
        role: "user",
        content: "Please call submit_idea with your dish now.",
      });
      continue;
    }
    messages.push({
      role: "user",
      content: calls.map((call) =>
        call.name === "find_foods"
          ? {
              type: "tool_result",
              tool_use_id: call.id,
              content: findFoodsResult(call.input.queries ?? [], req.dislikes),
            }
          : {
              type: "tool_result",
              tool_use_id: call.id,
              is_error: true,
              content:
                call.name === "submit_idea"
                  ? `Not accepted. ${review.problems.join(" ")} Use only the bare ids that find_foods returned, like usda-row-1234. Search for anything missing, then call submit_idea again.`
                  : "Unknown tool.",
            },
      ),
    });
  }
  const outOfTime = Date.now() - started > LAST_START_MS;
  logUsage("idea", usage, {
    ms: Date.now() - started,
    failed: outOfTime ? "out of time" : "too many steps",
  });
  throw new UserFacingError(
    outOfTime
      ? "This idea took too long. Try again."
      : "This idea took too many steps. Try again.",
    outOfTime ? 504 : 502,
  );
}

const RECIPE_TOOL = {
  name: "submit_recipe",
  description: "Submit the finished recipe.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: {
              type: "integer",
              description: "The ingredient's number from the list",
            },
            label: {
              type: "string",
              description:
                'What a cook calls it: "canned pumpkin", "large eggs", "Gruyère"',
            },
            qty: {
              type: "number",
              description:
                "Kitchen measure for the listed grams; 0 when grams is the best measure",
            },
            unit: {
              type: "string",
              description:
                'tsp, tbsp, cup, oz, lb, or a counted thing such as "egg", "clove", "medium onion", "fillet"; "g" when grams is best',
            },
            prep: {
              type: "string",
              description: 'Short prep note such as "finely diced", or ""',
            },
          },
          required: ["n", "label", "qty", "unit", "prep"],
          additionalProperties: false,
        },
      },
      seasonings: { type: "array", items: { type: "string" } },
      steps: { type: "array", items: { type: "string" } },
      tip: { type: "string" },
    },
    required: [
      "name",
      "description",
      "ingredients",
      "seasonings",
      "steps",
      "tip",
    ],
    additionalProperties: false,
  },
};

const RECIPE_SYSTEM = `You are a precise, warm recipe writer for Macro Genie. Write recipes people can cook from without guessing, and submit them with submit_recipe.

How amounts work: the site shows the recipe for any number of servings by scaling every amount. So you never write an amount yourself. In steps, refer to an ingredient's amount only with a placeholder: {3} means all of ingredient 3, {3:1/2} means half of it, {3:1/4} a quarter. Write the food's name after the placeholder: "Heat {2:1/2} olive oil", "Whisk {3} with {1} pumpkin". Temperatures, times, and pan sizes are written normally.

For each ingredient give: its number n, a label a cook would use, a kitchen measure (qty + unit) for exactly the listed grams, and a short prep note. Counted foods use the thing as the unit ("egg", "clove", "medium onion", "fillet") with a label like "large eggs". Use unit "g" and qty 0 when grams is the clearest measure (cheese by weight, meat).`;

export function recipePrompt(req, items, solved) {
  const per = NUTRIENTS.map(
    (n) =>
      `${formatAmount(solved.perServing[n.key])} ${n.unit} ${n.label.toLocaleLowerCase()}`,
  ).join(", ");
  return `Write the recipe for "${req.name}"${req.description ? ` (${req.description})` : ""}, ${req.servings} ${req.servings === 1 ? "serving" : "servings"}.

Use exactly these ingredients and amounts for the whole dish. They were sized to hit nutrition targets, so don't change them or add anything with real calories:
${items.map((item, i) => `${i + 1}. ${item.grams} g ${item.food.name}`).join("\n")}
${req.seasonings.length ? `Seasonings with negligible calories you may use freely: ${req.seasonings.join(", ")}.` : ""}
${req.dislikes.length ? `Never use: ${req.dislikes.join(", ")}.` : ""}
Per serving: ${per}.

Steps: numbered actions of one or two sentences each, in order, with temperatures and times, and no numbering in the text itself. Never mention the number of servings in steps (the recipe can be scaled); describe pans by size alone. Tip: one sentence on making it taste even better without changing the numbers.

Keep the name and description exactly as given, unless they mention a food that isn't in the list (for example after one was swapped); then write a better name and a one-sentence description.`;
}

const clean = (value, max) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// Turns Claude's submission into a recipe the page can render at any servings.
// Grams and foods always come from the request, never from the model.
export function buildRecipe(submission, req, items, solved) {
  const byN = new Map(
    (submission.ingredients ?? []).map((i) => [Number(i.n), i]),
  );
  const ingredients = items.map((item, index) => {
    const c = byN.get(index + 1) ?? {};
    const unit = clean(c.unit, 30);
    // The model's kitchen measure, checked against the food's real weight.
    const measure = checkMeasure(
      item.food,
      item.grams,
      Number(c.qty) > 0 && unit && !/^g(rams?)?$/i.test(unit)
        ? Number(c.qty)
        : null,
      unit,
    );
    return {
      id: item.food.id,
      name: item.food.name,
      label: clean(c.label, 60) || item.food.name,
      grams: item.grams,
      qty: measure.qty,
      unit: measure.qty ? measure.unit : "",
      prep: clean(c.prep, 80),
    };
  });
  return {
    version: 2,
    name: clean(submission.name, 120) || req.name,
    description: clean(submission.description, 400) || req.description,
    servings: req.servings,
    perServing: solved.perServing,
    gramsPerServing: solved.totalGrams / req.servings,
    ingredients,
    seasonings: (submission.seasonings ?? [])
      .map((s) => clean(s, 60))
      .filter((s) => s && !isDisliked({ name: s }, req.dislikes))
      .slice(0, 10),
    steps: (submission.steps ?? [])
      .map((s) => clean(s, 500).replace(/^\d+[.)]\s*/, ""))
      .filter(Boolean)
      .slice(0, 20),
    tip: clean(submission.tip, 300),
  };
}

// Writes a structured recipe for fixed ingredients and amounts.
export async function writeRecipe(
  input,
  api = client(),
  model = recipeModel(),
) {
  const req = methodRequest.parse(input);
  const items = req.ingredients
    .map(({ id, grams }) => ({ food: byId.get(id), grams: Math.round(grams) }))
    .filter((i) => i.food);
  if (!items.length)
    throw new UserFacingError("No known foods in this recipe.");
  const solved = solveRecipe(items, { servings: req.servings });
  const messages = [
    { role: "user", content: recipePrompt(req, items, solved) },
  ];
  const usage = emptyUsage(model);
  const started = Date.now();
  for (let turn = 0; turn < 2; turn++) {
    const timeout = BUDGET_MS - (Date.now() - started);
    if (timeout < 5_000) break;
    const response = await measure("ai", () =>
      api.beta.messages.create(
        request(model, {
          max_tokens: 6000,
          system: RECIPE_SYSTEM,
          tools: [RECIPE_TOOL],
          messages,
        }),
        { timeout },
      ),
    );
    addUsage(usage, response);
    checkStop(response);
    const submit = response.content.find(
      (b) => b.type === "tool_use" && b.name === "submit_recipe",
    );
    if (submit?.input?.steps?.length) {
      const recipe = buildRecipe(submit.input, req, items, solved);
      const line = logUsage("recipe", usage, { ms: Date.now() - started });
      return { ...recipe, usage: { model: line.model, costUsd: line.costUsd } };
    }
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: submit
        ? [
            {
              type: "tool_result",
              tool_use_id: submit.id,
              is_error: true,
              content: "The steps are missing. Submit the full recipe again.",
            },
          ]
        : "Please submit the recipe with submit_recipe now.",
    });
  }
  logUsage("recipe", usage, { ms: Date.now() - started, failed: "no recipe" });
  throw new UserFacingError(
    "The recipe didn't come back complete. Try again.",
    502,
  );
}
