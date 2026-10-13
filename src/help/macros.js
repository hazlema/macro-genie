export default {
  slug: "macros",
  title: "Set your macros",
  summary: "Ranges, per serving vs per 100 g, presets, and the phone panel.",
  thumb: "/help/macros-1.png",
  intro:
    "Every page that filters by nutrition uses the same table: a **Min** and a **Max** for protein, net carbs, calories, fat, sugar, and sodium.",
  steps: [
    {
      title: "Fill in only what matters",
      image: "/help/macros-1.png",
      markers: [{ n: 1, x: 13, y: 34 }],
      text: "Type a number in **Min**, **Max**, or both. A blank box means no limit, so leave anything you don't care about empty.",
    },
    {
      title: "Per serving or per 100 g",
      text: "On **Food Macros**, the dropdown above the table switches between the serving listed for each food and 100 g, which compares foods weight for weight. Recipe targets are always per serving.",
    },
    {
      title: "Start from a preset",
      text: "Under **A starting point**, presets like **Keto strict** or **Protein hunt** fill the table for you. Change any number afterwards.",
    },
    {
      title: "On your phone",
      image: "/help/macros-1-phone.png",
      markers: [{ n: 4, x: 5, y: 26 }],
      text: "Tap **Set your macros** to open the table. When you're done, **Show N foods** (or **Done** in the Recipe Builder) closes it and jumps to the results. The button then shows what's set, like \"Protein ≥ 30 g\".",
    },
    {
      title: "Leave out foods you won't eat",
      text: "Use **Foods you won’t eat** to hide them from search and keep them out of recipe ideas.",
    },
  ],
  outro: "Next: [Make a recipe](/help/builder).",
};
