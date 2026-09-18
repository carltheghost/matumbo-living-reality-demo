/** Deterministic Connected City district map for the Living Reality demo. */

export const CONNECTED_CITY_SCHEMA_VERSION = 1;
export const CONNECTED_CITY_SOURCE = "connected-city";
export const CONNECTED_CITY_CONSOLE_SOURCE = "connected-city-console";
export const CONNECTED_CITY_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const CONNECTED_CITY_BOUNDARY =
  "Connected City is a local district rehearsal. Visits and demo XP exist only in this page session; there is no credential, advice, reward token, persistence, wallet, provider read, or external authority.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

export const CONNECTED_CITY_DISTRICTS = freeze([
  {
    id: "city:finance-row",
    order: 1,
    label: "Finance Row",
    feature: "paycore",
    summary: "Rehearse value movement as pure interface: offers, routes, and holds that never touch real value.",
    charter: "Finance Row connects PAYCORE, T402, and Contracts as inspectable rehearsal surfaces.",
    question: "What can the demo's value surfaces actually move?",
    options: ["Real funds between wallets", "Nothing — every flow is a local rehearsal", "Tokens once a provider refreshes"],
    correctOption: 1,
    explanation: "Offers, routes, and holds are visible and inspectable here, but signing, custody, transfer, and settlement remain disabled.",
    xp: 20,
  },
  {
    id: "city:academy-quarter",
    order: 2,
    label: "Academy Quarter",
    feature: "academy",
    summary: "The restored learning path for Financial OS, HTTP 402/x402, T402, and PAYCORE boundaries.",
    charter: "Academy Quarter connects every district's boundary idea into one guided learning path.",
    question: "What does demo XP represent?",
    options: ["A redeemable reward token", "Local learning progress — not a token, reward, or credential", "A wallet balance"],
    correctOption: 1,
    explanation: "Demo XP is page-session learning state. It is not a token, reward, credential, or persisted identity record.",
    xp: 20,
  },
  {
    id: "city:arena-grounds",
    order: 3,
    label: "Arena Grounds",
    feature: "arena",
    summary: "Deterministic local games with legal turns, visible state, and replayable traces.",
    charter: "Arena Grounds connects play to proof: every turn is legal, visible, and replayable.",
    question: "Who are you playing against in the Game Lab?",
    options: ["Another person over the network", "A deterministic local simulation", "A ranked matchmaking pool"],
    correctOption: 1,
    explanation: "There is no multiplayer, network, imported runtime, or reward; turns are taken against a fixed local simulation.",
    xp: 20,
  },
  {
    id: "city:contract-row",
    order: 4,
    label: "Contract Row",
    feature: "contracts",
    summary: "Inspectable covenant records: select, follow links, and replay scenarios without executing anything.",
    charter: "Contract Row connects offers to evidence: inspectable records, never execution.",
    question: "What does opening a contract record do here?",
    options: ["Signs and settles the agreement", "Reads a local scenario record — it executes nothing", "Broadcasts it to a network"],
    correctOption: 1,
    explanation: "Contracts and pools are selectable records with replayable traces; there is no signing, custody, transfer, or settlement.",
    xp: 20,
  },
  {
    id: "city:ledger-plaza",
    order: 5,
    label: "Ledger Plaza",
    feature: "ledger",
    summary: "Prime Ledger and EchoProof: local journals of observations, linked and inspectable.",
    charter: "Ledger Plaza connects observations to proof: a local record, not an external truth.",
    question: "What does a proof entry establish in this demo?",
    options: ["That an external authority verified the claim", "That a local observation was recorded and linked", "That the record is legally binding"],
    correctOption: 1,
    explanation: "Proof here is a non-authoritative local journal; it records and links observations without claiming external truth.",
    xp: 20,
  },
  {
    id: "city:gateway-harbor",
    order: 6,
    label: "Gateway Harbor",
    feature: "gateway",
    summary: "Public-source observations with uncertainty, source links, and provider status — never fabricated rows.",
    charter: "Gateway Harbor connects the city to the outside world through explicit, user-triggered reads.",
    question: "When does the demo read public provider data?",
    options: ["Continuously in the background", "Only after you explicitly ask it to refresh", "Whenever a district opens"],
    correctOption: 1,
    explanation: "Public reads happen only on explicit refresh; unavailable or timed-out feeds stay unavailable and fail closed.",
    xp: 20,
  },
  {
    id: "city:social-market",
    order: 7,
    label: "Social Market",
    feature: "social-explorer",
    summary: "A local re-market rehearsal: discover, discuss, create, and preview allocation.",
    charter: "Social Market connects people to ideas as a rehearsal — no network, price, or trade.",
    question: "What happens in the Social Market rehearsal?",
    options: ["Real trades at live prices", "Local discovery and allocation preview — no market, price, or trade", "Publishing to a social network"],
    correctOption: 1,
    explanation: "The re-market is a local rehearsal with discover, discuss, create, and allocate-preview controls; there is no social network, price, or market.",
    xp: 20,
  },
]);

const DISTRICT_BY_ID = new Map(CONNECTED_CITY_DISTRICTS.map((district) => [district.id, district]));

export function createConnectedCityContribution({ updatedAt = CONNECTED_CITY_UPDATED_AT } = {}) {
  return freeze({
    schemaVersion: CONNECTED_CITY_SCHEMA_VERSION,
    source: CONNECTED_CITY_SOURCE,
    updatedAt,
    simulation: true,
    entities: CONNECTED_CITY_DISTRICTS.map((district) => ({
      id: district.id,
      kind: "city-district",
      label: district.label,
      order: district.order,
      feature: district.feature,
      summary: district.summary,
      charter: district.charter,
      simulation: true,
    })),
    evidence: [{ id: "connected-city:districts", kind: "fixed-district-map", districtIds: CONNECTED_CITY_DISTRICTS.map(({ id }) => id), status: "local" }],
    capabilities: [{ id: "connected-city.tour", mode: "local-rehearsal", authority: "none", executable: false }],
    boundary: CONNECTED_CITY_BOUNDARY,
  });
}

export function createConnectedCityState(selectedDistrictId = CONNECTED_CITY_DISTRICTS[0].id) {
  if (!DISTRICT_BY_ID.has(selectedDistrictId)) throw new RangeError(`Unknown Connected City district: ${selectedDistrictId}`);
  return freeze({
    source: CONNECTED_CITY_CONSOLE_SOURCE,
    selectedDistrictId,
    visitedDistrictIds: [],
    checkIns: {},
    xp: 0,
    trace: [],
    localOnly: true,
    simulation: true,
    persistence: false,
    credential: false,
    rewards: false,
    externalNetwork: false,
    executable: false,
  });
}

export function selectConnectedCityDistrict(state, districtId) {
  if (!DISTRICT_BY_ID.has(districtId)) throw new RangeError(`Unknown Connected City district: ${districtId}`);
  return freeze({ ...state, selectedDistrictId: districtId });
}

export function answerCharterCheck(state, optionIndex) {
  const district = DISTRICT_BY_ID.get(state?.selectedDistrictId);
  if (!district) throw new RangeError("Connected City state has no known selected district");
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= district.options.length) {
    throw new RangeError("Connected City charter answer option is out of range");
  }
  const priorCheckIns = Number(state.checkIns?.[district.id] ?? 0);
  const nextCheckIns = priorCheckIns + 1;
  const correct = optionIndex === district.correctOption;
  const alreadyVisited = state.visitedDistrictIds.includes(district.id);
  const award = correct && !alreadyVisited ? (priorCheckIns === 0 ? district.xp : Math.ceil(district.xp / 2)) : 0;
  const visitedDistrictIds = correct && !alreadyVisited
    ? [...state.visitedDistrictIds, district.id].sort((a, b) => DISTRICT_BY_ID.get(a).order - DISTRICT_BY_ID.get(b).order)
    : [...state.visitedDistrictIds];
  const entry = freeze({
    seq: state.trace.length + 1,
    districtId: district.id,
    optionIndex,
    correct,
    checkIn: nextCheckIns,
    award,
    explanation: district.explanation,
    localOnly: true,
  });
  return freeze({
    ...state,
    visitedDistrictIds,
    checkIns: { ...state.checkIns, [district.id]: nextCheckIns },
    xp: state.xp + award,
    trace: [...state.trace, entry].slice(-28),
  });
}

export function resetConnectedCity() {
  return createConnectedCityState();
}

export function getConnectedCityDistrict(districtId) {
  return DISTRICT_BY_ID.get(districtId) ?? null;
}

export const DEFAULT_CONNECTED_CITY = createConnectedCityContribution();
