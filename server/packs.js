// The credit packs for sale. Prices live only here; the page fetches them.
export const PACKS = [
  { id: "small", credits: 20, cents: 300 },
  { id: "medium", credits: 50, cents: 600 },
  { id: "large", credits: 120, cents: 1200 },
];

export const packById = (id) => PACKS.find((p) => p.id === id) ?? null;
