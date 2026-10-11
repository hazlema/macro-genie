// Checks a kitchen measure the model wrote against the food's weight, so
// "½ Granny Smith apple" for 35 g becomes the honest "⅕ apple".
//
// References, in order: the USDA serving when its unit matches (1 cup,
// 1 tbsp, 1 large egg, 1 slice), then typical weights of one medium piece
// for common counted foods (approximate; a check only acts on big misses).

const PIECE_GRAMS = [
  [/\bgarlic\b/, "clove", 3],
  [/\bshallots?\b/, null, 40],
  [/\bapples?\b/, null, 180],
  [/\bbananas?\b/, null, 118],
  [/\bpears?\b/, null, 178],
  [/\bpeach(es)?\b/, null, 150],
  [/\boranges?\b/, null, 131],
  [/\blemons?\b/, null, 85],
  [/\blimes?\b/, null, 67],
  [/\bavocados?\b/, null, 150],
  [/\btomato(es)?\b/, null, 123],
  [/\bsweet potato(es)?\b/, null, 130],
  [/\bpotato(es)?\b/, null, 213],
  [/\bcarrots?\b/, null, 61],
  [/\bonions?\b/, null, 110],
  [/\bpeppers?, (sweet|bell)|\bbell peppers?\b/, null, 119],
  [/\bzucchini\b|\bsquash, summer\b/, null, 196],
  [/\bcucumbers?\b/, null, 300],
  [/\beggs?\b/, null, 50],
  [/\bsalmon\b/, "fillet", 170],
  [/\bchicken\b.*\bbreast\b/, null, 174],
  [/\bchicken\b.*\bthigh\b/, null, 115],
  [/\bbacon\b/, "slice", 26],
];
const SIZE = {
  small: 0.7,
  medium: 1,
  large: 1.3,
  "extra-large": 1.5,
  jumbo: 1.6,
};
const VOLUME = { tsp: 1, teaspoon: 1, tbsp: 3, tablespoon: 3, cup: 48 };

const singular = (word) =>
  word
    .replace(/ies$/, "y")
    .replace(/(ch|sh|x|o)es$/, "$1")
    .replace(/s$/, "");
const words = (text) => text.toLocaleLowerCase().match(/[a-z-]+/g) ?? [];

// Grams in one of `unit` for this food, or null when nothing says.
export function gramsPerUnit(food, unit) {
  const unitWords = words(unit).map(singular);
  if (!unitWords.length) return null;
  const serving = food.serving?.label?.toLocaleLowerCase() ?? "";
  const servingQty = Number(serving.match(/^(\d*\.?\d+)/)?.[1]);
  const servingWords = words(serving.replace(/^[\d.\s]+/, "")).map(singular);
  const volume = unitWords.find((w) => w in VOLUME);
  if (volume) {
    // Whipped cream is mostly air: its cup weighs a quarter of liquid cream's.
    if (/whipped|whip\b/.test(serving)) return null;
    const ref = servingWords.find((w) => w in VOLUME);
    return ref && servingQty > 0
      ? (food.serving.grams / servingQty) * (VOLUME[volume] / VOLUME[ref])
      : null;
  }
  // "1 large" (egg) or "1 slice" (bacon): the serving names the same piece.
  const firstServingWord = servingWords[0];
  if (
    servingQty > 0 &&
    firstServingWord &&
    !(firstServingWord in VOLUME) &&
    (unitWords.includes(firstServingWord) ||
      (firstServingWord in SIZE && unitWords.some((w) => !(w in SIZE))))
  ) {
    const perServing = food.serving.grams / servingQty;
    const size = unitWords.find((w) => w in SIZE);
    return size && firstServingWord in SIZE
      ? (perServing * SIZE[size]) / SIZE[firstServingWord]
      : perServing;
  }
  const name = food.name.toLocaleLowerCase();
  const row = PIECE_GRAMS.find(
    ([pattern, piece]) =>
      pattern.test(name) && (!piece || unitWords.includes(piece)),
  );
  if (!row) return null;
  const size = unitWords.find((w) => w in SIZE);
  return row[2] * (size ? SIZE[size] : 1);
}

// The measure to show for `grams` of `food`, given the model's qty + unit.
// Returns { qty, unit } (qty null = show grams only).
export function checkMeasure(food, grams, qty, unit) {
  if (!(qty > 0) || !unit) return { qty: null, unit: "" };
  const per = gramsPerUnit(food, unit);
  if (!per) return { qty, unit };
  const expected = grams / per;
  const counted = !words(unit).some((w) => singular(w) in VOLUME);
  // Cups vary with the cut (sliced, chopped, halves), so volume only gets
  // corrected when it's off by more than double; counted pieces at 40%.
  const [low, high] = counted ? [0.6, 1.67] : [0.5, 2];
  if (qty / expected > low && qty / expected < high) return { qty, unit };
  // Under a fifth of a piece (or a pinch of volume), grams read better.
  if (
    (counted && expected < 0.2) ||
    (!counted &&
      expected *
        VOLUME[
          words(unit)
            .map(singular)
            .find((w) => w in VOLUME)
        ] <
        0.25)
  )
    return { qty: null, unit: "" };
  return { qty: Math.round(expected * 100) / 100, unit };
}
