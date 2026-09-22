import {
  ACADEMY_BOUNDARY,
  ACADEMY_CONSOLE_SOURCE,
  ACADEMY_LESSONS,
  answerAcademyLesson,
  createAcademyState,
  getAcademyLesson,
  resetAcademy,
  selectAcademyLesson,
} from "../domains/academy.js?v=20260922-cache2";

export { ACADEMY_CONSOLE_SOURCE };

const deepFreeze = (value) => {
  if (Array.isArray(value)) value.forEach(deepFreeze);
  else if (value && typeof value === "object") Object.values(value).forEach(deepFreeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function element(documentRoot, tag, className, value) {
  const node = documentRoot.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

export function createAcademyConsole({ documentRoot = globalThis.document, onChange = null } = {}) {
  const panel = documentRoot?.getElementById?.("academy-console");
  const closeButton = documentRoot?.getElementById?.("academy-close");
  const lessonList = documentRoot?.getElementById?.("academy-lessons");
  const question = documentRoot?.getElementById?.("academy-question");
  const options = documentRoot?.getElementById?.("academy-options");
  const progress = documentRoot?.getElementById?.("academy-progress");
  const feedback = documentRoot?.getElementById?.("academy-feedback");
  const trace = documentRoot?.getElementById?.("academy-trace");
  const resetButton = documentRoot?.getElementById?.("academy-reset");
  if (!panel || !closeButton || !lessonList || !question || !options || !progress || !feedback || !trace || !resetButton) {
    throw new Error("Financial Academy mount points are missing");
  }

  let state = createAcademyState();
  let opened = panel.hidden !== true;

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: ACADEMY_CONSOLE_SOURCE,
      action,
      method,
      opened,
      state,
      selectedLesson: getAcademyLesson(state.selectedLessonId),
      lessonCount: ACADEMY_LESSONS.length,
      completedCount: state.completedLessonIds.length,
      xp: state.xp,
      localOnly: true,
      simulation: true,
      persistence: false,
      credential: false,
      rewards: false,
      externalNetwork: false,
      executable: false,
      boundary: ACADEMY_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    onChange?.(next);
    return next;
  }

  function render() {
    const selected = getAcademyLesson(state.selectedLessonId);
    lessonList.replaceChildren();
    ACADEMY_LESSONS.forEach((lesson) => {
      const button = element(documentRoot, "button", "academy-lesson");
      button.type = "button";
      button.dataset.lessonId = lesson.id;
      button.setAttribute("aria-pressed", String(lesson.id === selected.id));
      button.append(
        element(documentRoot, "strong", "academy-lesson-title", `${lesson.order}. ${lesson.label}`),
        element(documentRoot, "span", "academy-lesson-state", state.completedLessonIds.includes(lesson.id) ? "COMPLETE" : "READY"),
        element(documentRoot, "span", "academy-lesson-summary", lesson.summary),
      );
      button.addEventListener("click", () => {
        state = selectAcademyLesson(state, lesson.id);
        feedback.textContent = "SELECT AN ANSWER · INCORRECT ANSWERS CAN BE RETRIED";
        render();
        publish("select-lesson", "button");
      });
      lessonList.appendChild(button);
    });
    question.textContent = selected.question;
    options.replaceChildren();
    selected.options.forEach((label, index) => {
      const button = element(documentRoot, "button", "academy-option", label);
      button.type = "button";
      button.dataset.optionIndex = String(index);
      button.addEventListener("click", () => {
        state = answerAcademyLesson(state, index);
        const result = state.trace[state.trace.length - 1];
        feedback.textContent = `${result.correct ? "CORRECT" : "TRY AGAIN"} · ${result.explanation}${result.award ? ` · +${result.award} DEMO XP` : ""}`;
        render();
        publish("answer", "button");
      });
      options.appendChild(button);
    });
    progress.textContent = `${state.completedLessonIds.length}/${ACADEMY_LESSONS.length} LESSONS · ${state.xp} DEMO XP · LOCAL SESSION`;
    trace.replaceChildren();
    if (!state.trace.length) trace.appendChild(element(documentRoot, "div", "academy-empty", "No answers yet. Choose a lesson and test the idea."));
    [...state.trace].reverse().forEach((entry) => trace.appendChild(element(documentRoot, "div", "academy-trace-row", `${entry.seq} · ${getAcademyLesson(entry.lessonId)?.label ?? entry.lessonId} · ${entry.correct ? "CORRECT" : "RETRY"} · +${entry.award} XP`)));
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) render();
    return publish(opened ? "open" : "close", method);
  }

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  resetButton.addEventListener("click", () => {
    state = resetAcademy();
    feedback.textContent = "PROGRESS RESET · LOCAL SESSION ONLY";
    render();
    publish("reset", "button");
  });
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    reset: (method = "api") => { state = resetAcademy(); render(); return publish("reset", method); },
    select: (lessonId, method = "api") => { state = selectAcademyLesson(state, lessonId); render(); return publish("select-lesson", method); },
    answer: (optionIndex, method = "api") => { state = answerAcademyLesson(state, optionIndex); render(); return publish("answer", method); },
    replay: (method = "api") => publish("replay", method),
    getSnapshot: () => snapshot(),
    boundary: ACADEMY_BOUNDARY,
  });
}

export default createAcademyConsole;
