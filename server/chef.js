// Server-only: asks Claude for dish ideas and recipe methods. Claude picks
// foods and rough amounts; the numbers always come from the USDA data and the
// solver, never from the model.
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, addUsage, emptyUsage, logUsage } from "./usage.js";
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

// Each of the five parallel requests leans a different way so the ideas differ.
export const ANGLES = [
  "a bake, casserole, or gratin",
  "a skillet, stir-fry, or sauté",
  "a soup, stew, or curry",
  "a salad, bowl, or composed plate",
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
- Include every food the person asked for as an ingredient. Search for each one and pick the plainest match (for "eggs": "Egg, whole, raw, fresh").
- Never use a food they won't eat, or anything containing it.
- Prefer plain, unprocessed entries. Watch for hidden carbs and sugar: pie mixes, breaded or battered items, sweetened products, sauces.
- Seasonings are for things with negligible calories only: salt, pepper, dried or fresh herbs, spices, garlic, vinegar, citrus zest, water. Everything with real calories must be an ingredient from find_foods.
- Aim for amounts that roughly fit the targets. The site adjusts the grams afterwards to hit the numbers exactly, so don't do precise arithmetic.
- It must taste great. Think about fat, acid, salt, texture, and browning.
- Name the dish the way a good menu would. The description is one sentence a hungry person would want to read.`;

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
            },
            required: ["id", "grams", "required"],
            additionalProperties: false,
          },
        },
        seasonings: { type: "array", items: { type: "string" } },
      },
      required: ["name", "description", "ingredients", "seasonings"],
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
    items.push({
      food,
      grams: Math.min(Math.round(grams), 5000),
      // Foods the person asked for must stay in the dish.
      required:
        !!ingredient.required || asked.some((w) => answersRequest(food, w)),
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
    [...items.map((i) => i.food.name), ...seasonings],
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
    })),
  };
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_BASE_URL)
    throw new UserFacingError(
      "Recipe ideas aren't set up yet: the site needs an ANTHROPIC_API_KEY.",
      503,
    );
  // One attempt that finishes inside Netlify's 60-second function limit.
  return new Anthropic({ timeout: 55_000, maxRetries: 0 });
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

// Each turn is one model call; five fit comfortably in the 60-second limit.
const MAX_TURNS = 5;

export async function generateIdea(input, api = client(), model = ideaModel()) {
  const req = ideaRequest.parse(input);
  const messages = [{ role: "user", content: ideaPrompt(req) }];
  const usage = emptyUsage(model);
  const started = Date.now();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await api.beta.messages.create(
      request(model, {
        max_tokens: 8000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
      }),
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
    const lastTurn = turn === MAX_TURNS - 1;
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
  logUsage("idea", usage, {
    ms: Date.now() - started,
    failed: "too many steps",
  });
  throw new UserFacingError("This idea took too many steps. Try again.", 502);
}

export function methodPrompt(req) {
  const items = req.ingredients
    .map(({ id, grams }) => ({ food: byId.get(id), grams: Math.round(grams) }))
    .filter((i) => i.food);
  if (!items.length)
    throw new UserFacingError("No known foods in this recipe.");
  const solved = solveRecipe(items, { servings: req.servings });
  const per = NUTRIENTS.map(
    (n) =>
      `${formatAmount(solved.perServing[n.key])} ${n.unit} ${n.label.toLocaleLowerCase()}`,
  ).join(", ");
  return `Write the recipe for "${req.name}"${req.description ? ` (${req.description})` : ""}, ${req.servings} ${req.servings === 1 ? "serving" : "servings"}.

Use exactly these ingredients and amounts for the whole dish. They were sized to hit nutrition targets, so don't change them or add anything with real calories:
${items.map((i) => `- ${i.grams} g ${i.food.name}`).join("\n")}
${req.seasonings.length ? `Seasonings you may use freely: ${req.seasonings.join(", ")}.` : ""}
${req.dislikes.length ? `Never use: ${req.dislikes.join(", ")}.` : ""}
Per serving: ${per}.

Format, in plain text with no Markdown symbols other than these:
## Ingredients
- one line each: kitchen measure first, grams in brackets, short prep note
## Method
1. numbered steps, each one or two sentences, with temperatures and times
## Tip
One sentence on making it taste even better without changing the numbers.`;
}

// Streams the method as plain text chunks.
export async function streamMethod(
  input,
  api = client(),
  model = recipeModel(),
) {
  const req = methodRequest.parse(input);
  const stream = api.beta.messages.stream(
    request(model, {
      max_tokens: 6000,
      system:
        "You are a precise, warm recipe writer for Macro Genie. Write recipes people can cook from without guessing.",
      messages: [{ role: "user", content: methodPrompt(req) }],
    }),
  );
  return stream;
}
