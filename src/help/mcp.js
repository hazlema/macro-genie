export default {
  slug: "mcp",
  title: "Chat with your AI (MCP)",
  summary: "Connect Claude or another AI app and just ask.",
  category: "Integrations",
  thumb: "/help/thumbs/mcp.svg",
  intro:
    "Macro Genie has an MCP server: a door that lets AI assistants like Claude use its data. Connect it once, then ask in plain words. Your AI can search 8,490 USDA foods, look up any food in detail, and size recipes to your targets. It's free, read-only, and needs no account.",
  steps: [
    {
      title: "Copy the server address",
      text: "This is the address your AI app needs:",
      copy: "{{MCP_URL}}",
    },
    {
      title: "Claude on the web or desktop",
      text: 'Go to **Customize → Connectors**, choose **Add**, then **Add custom connector**. Name it "Macro Genie", paste the address, and leave sign-in off. Free plans can add one custom connector. Connectors you add here also appear in Claude Code.',
      image: "/help/mcp-1.svg",
    },
    {
      title: "Claude Code",
      text: "Run this in a terminal:",
      copy: "claude mcp add --transport http macro-genie {{MCP_URL}}",
    },
    {
      title: "Other MCP apps",
      text: "Add a **Streamable HTTP** MCP server with the same address. No sign-in or key is needed.",
    },
    {
      title: "Ask it things",
      text: "Try:\n\n- Find snacks under 150 kcal with at least 15 g protein\n- Which cheeses have the most protein per 100 g?\n- I have chicken thighs, broccoli and rice: size a dish for 4 with 40 g protein and under 600 kcal per serving\n- Compare the sodium in canned vs dried black beans\n- List the food categories you know\n- What's in 100 g of salmon?",
      image: "/help/mcp-2.svg",
    },
    {
      title: "Let it size recipes",
      text: "Give it ingredients and per-serving targets and it sizes every gram with the same solver the Recipe Builder uses, telling you if the targets can't all be met.",
      image: "/help/mcp-3.svg",
    },
  ],
  outro:
    "The four tools your AI gets: **search foods** by nutrition ranges and name, **food details** for one food, **food categories**, and **size a recipe**. Community recipes aren't searchable from your AI yet.",
};
