// The first-timer tour of the Recipe Builder: point-and-explain, no input.
// `selector` is where the spotlight goes (one selector or several, boxed
// together); none means a centred card. `panel` opens or closes the phone
// targets panel so the anchor is on screen. `textSignedOut` replaces `text`
// for visitors without an account.
export const STEPS = [
  {
    title: "Welcome to the Recipe Builder.",
    text: "It makes a recipe from your numbers. Seven quick stops.",
  },
  {
    title: "Set targets per serving.",
    text: "Blank means no limit, and one or two is plenty: try at least 30 g protein and under 600 calories.",
    selector: ".range-table",
    panel: "open",
  },
  {
    title: "Not sure where to start?",
    text: "A preset fills the table for you. Change any number afterwards.",
    selector: ".presets",
    panel: "open",
  },
  {
    title: "Say what you'd like.",
    text: "Name foods you want in it, and anything else that matters: “comfort food, no oven”. Both are optional.",
    selector: ".brief .note-field",
    panel: "closed",
  },
  {
    title: "Get ideas.",
    text: "Each idea costs one credit; new accounts get 10. Ideas arrive within about half a minute, with every gram worked out from USDA data.",
    textSignedOut:
      "Sign in first; it's free. Each idea costs one credit; new accounts get 10. Ideas arrive within about half a minute, with every gram worked out from USDA data.",
    selector: ".brief-actions .primary-button",
    panel: "closed",
  },
  {
    title: "Then cook, keep, share.",
    text: "Choose an idea with Cook this one, then Write the recipe for the steps. Save it to your Recipe Book, and share it in the Community if it worked.",
    selector: [".tabs button:nth-child(2)", ".tabs button:nth-child(3)"],
    panel: "closed",
  },
  {
    title: "That's it.",
    text: "Run this again any time from Help.",
  },
];
