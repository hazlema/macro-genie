// Runs the same recipe requests through two or more models and writes a
// side-by-side report, so idea and recipe quality can be judged by eye.
// Needs ANTHROPIC_API_KEY (in .env or the shell). Costs real money: roughly
// $0.50 for the default Opus vs Sonnet run.
//
//   npm run compare                       # Opus 5.5 vs Sonnet 5.5
//   npm run compare -- claude-haiku-5-5   # any models from server/usage.js
import { mkdirSync, writeFileSync } from "node:fs";
import { generateIdea, writeRecipe } from "../server/chef.js";
import { NUTRIENTS } from "../src/lib/foods.js";
import { structuredText } from "../src/lib/scale.js";
import { MODELS } from "../server/usage.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "No ANTHROPIC_API_KEY found. Put it in .env (ANTHROPIC_API_KEY=sk-ant-...) or the shell, then run again.",
  );
  process.exit(1);
}
// Same key handling as npm run dev: the .env key, straight to Anthropic.
process.env.MACRO_GENIE_LOCAL = "1";
process.env.MACRO_GENIE_LOCAL_KEY = process.env.ANTHROPIC_API_KEY;

const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["claude-opus-5-5", "claude-sonnet-5-5"];
for (const m of models)
  if (!MODELS.includes(m))
    throw new Error(`Unknown model ${m}. Use: ${MODELS.join(", ")}`);

const briefs = [
  {
    title: "Keto pumpkin comfort food",
    servings: 4,
    ranges: { netCarbs: { max: 5 }, calories: { max: 600 } },
    want: ["pumpkin", "eggs", "onions"],
    note: "comfort food",
    dislikes: [],
  },
  {
    title: "High-protein weeknight",
    servings: 2,
    ranges: { protein: { min: 40 }, calories: { max: 550 } },
    want: ["chicken thighs", "broccoli"],
    note: "weeknight, 30 minutes",
    dislikes: ["cilantro"],
  },
  {
    title: "Light lunch, surprise me",
    servings: 2,
    ranges: { protein: { min: 25 }, sodium: { max: 600 } },
    want: [],
    note: "something light for lunch",
    dislikes: ["mushrooms"],
  },
];
const ANGLES = [0, 2]; // a bake, and a soup or stew

// Keep the per-call usage lines out of the console; the report has totals.
const log = console.log;
console.log = (line, ...rest) => {
  if (typeof line === "string" && line.startsWith('{"event":"ai_usage"'))
    return;
  log(line, ...rest);
};

const fmt = (v) => (v == null ? "—" : Math.round(v * 10) / 10);
const macros = (p) =>
  `${fmt(p.calories)} kcal, ${fmt(p.protein)} g protein, ${fmt(p.netCarbs)} g net carbs, ${fmt(p.fat)} g fat, ${fmt(p.sodium)} mg sodium`;

async function runIdea(brief, angle, model) {
  const started = Date.now();
  try {
    const { title, ...request } = brief;
    const idea = await generateIdea({ ...request, angle }, undefined, model);
    return { idea, seconds: (Date.now() - started) / 1000 };
  } catch (error) {
    return { error: error.message, seconds: (Date.now() - started) / 1000 };
  }
}

async function runRecipe(brief, idea, model) {
  const started = Date.now();
  try {
    const recipe = await writeRecipe(
      {
        name: idea.name,
        description: idea.description,
        servings: brief.servings,
        seasonings: idea.seasonings,
        dislikes: brief.dislikes,
        ingredients: idea.ingredients
          .filter((i) => i.grams > 0)
          .map((i) => ({ id: i.id, grams: i.grams })),
      },
      undefined,
      model,
    );
    // Shown at the requested servings and at double, to check the scaling reads well.
    return {
      text: `${structuredText(recipe, brief.servings, NUTRIENTS)}\n\n---\nScaled to ${brief.servings * 2} servings:\n\n${structuredText(recipe, brief.servings * 2, NUTRIENTS)}`,
      costUsd: recipe.usage.costUsd,
      seconds: (Date.now() - started) / 1000,
    };
  } catch (error) {
    return { error: error.message, seconds: (Date.now() - started) / 1000 };
  }
}

const results = {}; // results[model] = [{ brief, ideas: [...], recipe }]
log(`Comparing ${models.join(" vs ")} on ${briefs.length} requests…`);
await Promise.all(
  models.map(async (model) => {
    results[model] = await Promise.all(
      briefs.map(async (brief) => {
        const ideas = await Promise.all(
          ANGLES.map((angle) => runIdea(brief, angle, model)),
        );
        const first = ideas.find((r) => r.idea)?.idea;
        const recipe = first ? await runRecipe(brief, first, model) : null;
        log(`  ${model}: ${brief.title} done`);
        return { brief, ideas, recipe };
      }),
    );
  }),
);

const lines = [
  `# Model comparison, ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
  "",
];
const summary = [];
for (const model of models) {
  const runs = results[model];
  const ideas = runs.flatMap((r) => r.ideas);
  const ok = ideas.filter((r) => r.idea);
  const recipes = runs.map((r) => r.recipe).filter((r) => r?.text);
  const avg = (xs) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  summary.push({
    model,
    ideas: `${ok.length}/${ideas.length}`,
    fit: `${ok.filter((r) => r.idea.fits).length}/${ok.length}`,
    "¢ per idea": (avg(ok.map((r) => r.idea.usage.costUsd)) * 100).toFixed(1),
    "s per idea": avg(ideas.map((r) => r.seconds)).toFixed(1),
    "¢ per recipe": (avg(recipes.map((r) => r.costUsd)) * 100).toFixed(1),
    "s per recipe": avg(recipes.map((r) => r.seconds)).toFixed(1),
  });
}
lines.push("| " + Object.keys(summary[0]).join(" | ") + " |");
lines.push(
  "|" +
    Object.keys(summary[0])
      .map(() => "---")
      .join("|") +
    "|",
);
for (const row of summary)
  lines.push("| " + Object.values(row).join(" | ") + " |");
lines.push("");

briefs.forEach((brief, b) => {
  lines.push(`## ${brief.title}`, "");
  lines.push(
    `Serves ${brief.servings}. Wants: ${brief.want.join(", ") || "anything"}. Note: ${brief.note}. Won't eat: ${brief.dislikes.join(", ") || "nothing"}.`,
    "",
  );
  for (const model of models) {
    const run = results[model][b];
    lines.push(`### ${model}`, "");
    for (const r of run.ideas) {
      if (r.error) {
        lines.push(`- **Failed:** ${r.error}`, "");
        continue;
      }
      const i = r.idea;
      lines.push(
        `**${i.name}** (${r.seconds.toFixed(0)} s, ${(i.usage.costUsd * 100).toFixed(1)}¢, ${i.fits ? "fits" : "close match"}${i.missing.length ? `, leaves out ${i.missing.join(", ")}` : ""})`,
        "",
        i.description,
        "",
        `Per serving: ${macros(i.perServing)}`,
        "",
        ...i.ingredients
          .filter((x) => x.grams > 0)
          .map((x) => `- ${x.grams} g ${x.name}`),
        i.seasonings.length ? `- Season: ${i.seasonings.join(", ")}` : "",
        "",
      );
    }
    if (run.recipe?.text)
      lines.push(
        `<details><summary>Written recipe for the first idea (${run.recipe.seconds.toFixed(0)} s, ${(run.recipe.costUsd * 100).toFixed(1)}¢)</summary>`,
        "",
        run.recipe.text,
        "",
        "</details>",
        "",
      );
    else if (run.recipe?.error)
      lines.push(`Recipe failed: ${run.recipe.error}`, "");
  }
});

mkdirSync("reports", { recursive: true });
const file = `reports/model-compare-${Date.now()}.md`;
writeFileSync(file, lines.join("\n"));
console.table(summary);
log(`Full side-by-side report: ${file}`);
