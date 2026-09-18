/** Deterministic Financial Academy learning path for the Living Reality demo. */

export const ACADEMY_SCHEMA_VERSION = 1;
export const ACADEMY_SOURCE = "financial-academy";
export const ACADEMY_CONSOLE_SOURCE = "financial-academy-console";
export const ACADEMY_UPDATED_AT = "2025-01-01T00:00:00.000Z";
export const ACADEMY_BOUNDARY =
  "Academy is a local educational rehearsal. Progress and XP exist only in this page session; there is no credential, financial advice, wallet, reward token, persistence, or external authority.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

export const ACADEMY_LESSONS = freeze([
  {
    id: "academy:financial-os",
    order: 1,
    label: "Financial OS foundations",
    summary: "Separate a useful financial interface from the authority that actually holds or moves value.",
    question: "What does the maTumbo demo itself control?",
    options: ["A local projection and rehearsal", "A regulated bank account", "A production custody wallet"],
    correctOption: 0,
    explanation: "The browser controls presentation and deterministic local rehearsal state. External financial authority remains separate.",
    xp: 30,
  },
  {
    id: "academy:http-402",
    order: 2,
    label: "HTTP 402 and x402",
    summary: "Understand the difference between a web payment-required response and a settlement protocol.",
    question: "Does receiving HTTP 402 prove that payment settled?",
    options: ["Yes, always", "No; it only expresses a payment-required boundary", "Only when the page is 3-D"],
    correctOption: 1,
    explanation: "HTTP 402 can describe a requirement. A separate verified payment protocol and settlement receipt are needed for finality.",
    xp: 30,
  },
  {
    id: "academy:t402",
    order: 3,
    label: "T402 conditional value",
    summary: "Follow offer, route, hold, evidence, and release as distinct stages.",
    question: "Which stage may move value in this demo?",
    options: ["Offer", "Hold", "None; every stage is a local rehearsal"],
    correctOption: 2,
    explanation: "T402 is visible and inspectable here, but signing, custody, release, and settlement remain disabled.",
    xp: 30,
  },
  {
    id: "academy:paycore",
    order: 4,
    label: "PAYCORE and evidence",
    summary: "Compile intent, policy, budget, route, and evidence before any future action.",
    question: "Why keep evidence separate from execution?",
    options: ["So a renderer or provider observation cannot move value", "To hide the source", "To create a guaranteed return"],
    correctOption: 0,
    explanation: "Evidence informs a decision but does not grant signing, custody, transfer, or settlement authority.",
    xp: 30,
  },
]);

const LESSON_BY_ID = new Map(ACADEMY_LESSONS.map((lesson) => [lesson.id, lesson]));

export function createAcademyContribution({ updatedAt = ACADEMY_UPDATED_AT } = {}) {
  return freeze({
    schemaVersion: ACADEMY_SCHEMA_VERSION,
    source: ACADEMY_SOURCE,
    updatedAt,
    simulation: true,
    entities: ACADEMY_LESSONS.map((lesson) => ({
      id: lesson.id,
      kind: "academy-lesson",
      label: lesson.label,
      order: lesson.order,
      summary: lesson.summary,
      simulation: true,
    })),
    evidence: [{ id: "academy:path", kind: "fixed-learning-path", lessonIds: ACADEMY_LESSONS.map(({ id }) => id), status: "local" }],
    capabilities: [{ id: "academy.learn", mode: "local-rehearsal", authority: "none", executable: false }],
    boundary: ACADEMY_BOUNDARY,
  });
}

export function createAcademyState(selectedLessonId = ACADEMY_LESSONS[0].id) {
  if (!LESSON_BY_ID.has(selectedLessonId)) throw new RangeError(`Unknown Academy lesson: ${selectedLessonId}`);
  return freeze({
    source: ACADEMY_CONSOLE_SOURCE,
    selectedLessonId,
    completedLessonIds: [],
    attempts: {},
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

export function selectAcademyLesson(state, lessonId) {
  if (!LESSON_BY_ID.has(lessonId)) throw new RangeError(`Unknown Academy lesson: ${lessonId}`);
  return freeze({ ...state, selectedLessonId: lessonId });
}

export function answerAcademyLesson(state, optionIndex) {
  const lesson = LESSON_BY_ID.get(state?.selectedLessonId);
  if (!lesson) throw new RangeError("Academy state has no known selected lesson");
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= lesson.options.length) {
    throw new RangeError("Academy answer option is out of range");
  }
  const priorAttempts = Number(state.attempts?.[lesson.id] ?? 0);
  const nextAttempts = priorAttempts + 1;
  const correct = optionIndex === lesson.correctOption;
  const alreadyComplete = state.completedLessonIds.includes(lesson.id);
  const award = correct && !alreadyComplete ? (priorAttempts === 0 ? lesson.xp : Math.ceil(lesson.xp / 2)) : 0;
  const completedLessonIds = correct && !alreadyComplete
    ? [...state.completedLessonIds, lesson.id].sort((a, b) => LESSON_BY_ID.get(a).order - LESSON_BY_ID.get(b).order)
    : [...state.completedLessonIds];
  const entry = freeze({
    seq: state.trace.length + 1,
    lessonId: lesson.id,
    optionIndex,
    correct,
    attempt: nextAttempts,
    award,
    explanation: lesson.explanation,
    localOnly: true,
  });
  return freeze({
    ...state,
    completedLessonIds,
    attempts: { ...state.attempts, [lesson.id]: nextAttempts },
    xp: state.xp + award,
    trace: [...state.trace, entry].slice(-24),
  });
}

export function resetAcademy() {
  return createAcademyState();
}

export function getAcademyLesson(lessonId) {
  return LESSON_BY_ID.get(lessonId) ?? null;
}

export const DEFAULT_ACADEMY = createAcademyContribution();
