/**
 * Trusted, bundled Bot Plaza helpers. These are finite local scripts, not AI
 * providers. They return chat text and never call the runtime context or tools.
 * The registry restores their preferences by factory id and exact version.
 */

const VERSION = "1.0.0";
const normalize = (value) => String(value ?? "").slice(0, 1000).toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const contains = (text, phrase) => (` ${text} `).includes(` ${normalize(phrase)} `);

// IDs are existing feature routes. The renderer owns navigation; these helpers
// only explain where to go. Tests check this catalog against the real registry.
export const LENS_GUIDE_ROUTES = Object.freeze([
  { id: "reality-lens", label: "Reality Lens", aliases: ["home", "reality lens", "rotate", "view dial"], tip: "Use the View dial to turn around, then select an object to open its space." },
  { id: "person", label: "Person Studio", aliases: ["person", "avatar", "personal room", "identity"], tip: "Open your personal room, choose a look and review the avatar controls." },
  { id: "rooms", label: "Rooms + Messaging", aliases: ["room", "rooms", "messages", "messaging", "chat"], tip: "Create or enter a local room, save a message and export its history. Messages stay in this browser." },
  { id: "block-world", label: "Block World", aliases: ["blocks", "block world", "voxel", "fabric"], tip: "Select a block to inspect its contents or move the local draft." },
  { id: "youtube", label: "YouTube", aliases: ["youtube", "video", "videos", "watch"], tip: "Search on the media object, choose a result and play it there." },
  { id: "web-ai", label: "My GPT / Web + AI", aliases: ["gpt", "my gpt", "chatgpt", "openai", "ai", "web ai"], tip: "Connect through the local server, choose an assistant and send selected context. Connection happens only through its controls." },
  { id: "bot-plaza", label: "Bot Plaza", aliases: ["bot", "bots", "plugins", "bot plaza", "agent"], tip: "Choose a scripted bot, chat locally and review its enabled preference and approved capabilities." },
  { id: "wardrobe-atelier", label: "Wardrobe Atelier", aliases: ["wardrobe", "outfit", "outfits", "clothes", "clothing"], tip: "Design a local outfit, equip it and save a backup. Starter looks can dress the Person Studio avatar." },
  { id: "nft-atelier", label: "NFT Atelier", aliases: ["nft", "nfts", "collectible", "collectibles"], tip: "Create a simulated collectible, inspect its provenance and export your local collection." },
  { id: "contract-atelier", label: "Contract Atelier", aliases: ["contract", "contracts", "pool", "pools", "stake"], tip: "Create a fictional contract, inspect its outcomes and use rehearsal credits. Export a backup of your manual journal." },
  { id: "academy", label: "Financial Academy", aliases: ["academy", "lesson", "lessons", "learn", "learning"], tip: "Choose a lesson, answer its questions and review the explanation before moving on." },
  { id: "chess", label: "Chess", aliases: ["chess", "checkmate"], tip: "Choose local AI or two-player mode, select a piece and follow the highlighted legal moves." },
  { id: "arena", label: "Arena / Game Lab", aliases: ["arena", "game", "games", "orbital", "chrono", "nebula"], tip: "Choose one of the three local games, take legal turns and replay the event history." },
  { id: "gateway", label: "World Gateway / Evidence", aliases: ["research", "sources", "evidence", "gateway", "news"], tip: "Refresh a documented public source on demand and inspect its URL, time and uncertainty." },
  { id: "multi-sport-events", label: "Multi-Sport Scoreboards", aliases: ["sports", "scoreboard", "soccer", "nba", "nfl"], tip: "Choose a fixed public scoreboard and refresh it explicitly; inspect the returned source and status." },
  { id: "social-mirror", label: "Social Mirror", aliases: ["social", "social mirror", "feed", "timeline"], tip: "Review the configured official embeds and each source's connection status." },
  { id: "asset-market", label: "Asset Market Evidence", aliases: ["market", "prices", "price"], tip: "Request a bounded public market snapshot. TUMBO-SIM remains unlisted and unpriced." },
  { id: "white-paper", label: "White Paper", aliases: ["white paper", "whitepaper", "vision", "documentation"], tip: "Read the living local document and its feature and authority boundaries." },
].map((route) => Object.freeze({ ...route, aliases: Object.freeze(route.aliases) })));

function guideReply(message) {
  const text = normalize(message?.text);
  const matches = LENS_GUIDE_ROUTES.filter((route) =>
    contains(text, route.id) || route.aliases.some((alias) => contains(text, alias)));
  if (matches.length === 1) {
    const route = matches[0];
    return `Lens Guide · scripted local guide. Open ${route.label} from Features, or use ?feature=${route.id}. ${route.tip} This reply does not open it automatically.`;
  }
  if (matches.length > 1) {
    return `Lens Guide · scripted local guide. Your request matches these spaces: ${matches.slice(0, 4).map((route) => `${route.label} (?feature=${route.id})`).join("; ")}. Open Features and choose one, or ask me about a single space.`;
  }
  return "Lens Guide · scripted local guide. Open Features to find every space. Try asking about My GPT, Rooms, Person, Wardrobe, YouTube, Chess, Arena, Academy, NFT or Contracts. Use Home to return to Reality Lens and the View dial to rotate. I match a fixed local route vocabulary; I do not browse or run actions.";
}

const PLANS = Object.freeze([
  { words: ["research", "compare", "sources", "evidence"], steps: ["Write the exact question and the decision it supports.", "Choose two public sources in World Gateway; check date and provenance.", "Record what each source supports and where they disagree.", "Separate observed facts from your interpretation.", "Save your notes in a local room and decide the next small action."] },
  { words: ["build", "create", "design", "make", "implement"], steps: ["Describe the result in one sentence and choose its space.", "List the inputs and the smallest useful first version.", "Create one draft before adding more features.", "Try a normal path and a failed or missing-input path.", "Review the result, export a backup where available and choose the next change."] },
  { words: ["learn", "study", "lesson", "academy"], steps: ["Choose one topic and write what you want to understand.", "Open one Academy lesson and read its explanation.", "Answer its questions without guessing from the score.", "Write why a missed answer was wrong and try again.", "Explain the idea in your own words and choose the next lesson."] },
  { words: ["organize", "organise", "clean", "chaos", "plan"], steps: ["Choose one space to organize first.", "Write what you want to keep, change and remove.", "Export a backup where the space supports one.", "Make one small change and check the result.", "Record the remaining tasks in a local room, then choose the next space."] },
]);

function planReply(message) {
  const text = normalize(message?.text);
  const template = PLANS.find(({ words }) => words.some((word) => contains(text, word))) ?? PLANS[3];
  const request = String(message?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return `Plan Helper · scripted local checklist${request ? ` for “${request}”` : ""}. ${template.steps.map((step, index) => `${index + 1}. ${step}`).join(" ")} Nothing has been executed or scheduled; copy the checklist to a room to keep it.`;
}

export function createLensGuidePlugin() {
  return { id: "lens-guide", name: "Lens Guide", avatar: "orb-teal", version: VERSION,
    description: "Scripted local guide to existing feature routes. Suggests where to go; never navigates or calls tools.",
    capabilities: [], onMessage: (_ctx, message) => guideReply(message) };
}

export function createPlanHelperPlugin() {
  return { id: "plan-helper", name: "Plan Helper", avatar: "orb-gold", version: VERSION,
    description: "Scripted local planning checklists for creating, learning, research and organizing. No provider, actions or scheduling.",
    capabilities: [], onMessage: (_ctx, message) => planReply(message) };
}

export const LENS_BOT_FACTORIES = Object.freeze({
  "lens-guide": Object.freeze({ version: VERSION, create: createLensGuidePlugin }),
  "plan-helper": Object.freeze({ version: VERSION, create: createPlanHelperPlugin }),
});
