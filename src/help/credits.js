export default {
  slug: "credits",
  title: "Credits",
  summary: "What uses a credit, refunds, and where to see your balance.",
  category: "Basics",
  thumb: "/help/thumbs/credits.webp",
  intro:
    "Food search, the Community, and chatting with your AI are free. The Recipe Builder uses credits because every idea calls Claude.",
  steps: [
    {
      title: "You start with 10",
      text: "Every new account gets **10 free credits**.",
    },
    {
      title: "What uses one",
      text: "Each recipe idea uses one credit, and so does each written recipe. The Builder shows the cost before you ask.",
    },
    {
      title: "Failures are refunded",
      text: "If an idea or recipe fails, its credit comes back automatically. You don't need to ask.",
    },
    {
      title: "See your balance",
      image: "/help/credits-1.png",
      imagePhone: "/help/credits-1-phone.png",
      markers: [{ n: 4, x: 80, y: 4 }],
      markersPhone: [{ n: 4, x: 70, y: 2 }],
      text: "Your credits show at the top of the page. On a phone, tap the credits button for your account menu.",
    },
    {
      title: "Getting more",
      text: "Buy more on the [Get more credits](/credits) page: 20 credits for $3, 50 for $6, or 120 for $12. You pay by card through Stripe. Credits don't expire, and unused credits from a pack can be refunded within 30 days. See [Refunds](/refunds).",
    },
  ],
};
