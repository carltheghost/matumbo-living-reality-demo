import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ACADEMY_LESSONS,
  ACADEMY_SOURCE,
  answerAcademyLesson,
  createAcademyContribution,
  createAcademyState,
  selectAcademyLesson,
} from "../src/domains/academy.js";
import { createAcademyConsole } from "../src/render/academy.js";

function node(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot, tagName: tag.toUpperCase(), dataset: {}, hidden: false,
    textContent: "", children: [], listeners: new Map(), attributes: new Map(),
    append(...items) { items.forEach((item) => this.children.push(item)); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
}

function documentFixture() {
  const elements = new Map();
  const documentRoot = {
    createElement: (tag) => node(documentRoot, tag),
    getElementById: (id) => elements.get(id) ?? null,
  };
  ["academy-console", "academy-close", "academy-lessons", "academy-question", "academy-options", "academy-progress", "academy-feedback", "academy-trace", "academy-reset"]
    .forEach((id) => { const entry = node(documentRoot); entry.hidden = id === "academy-console"; elements.set(id, entry); });
  return documentRoot;
}

test("Academy contributes a fixed four-lesson Financial OS path", () => {
  const contribution = createAcademyContribution();
  assert.equal(contribution.source, ACADEMY_SOURCE);
  assert.equal(contribution.entities.length, 4);
  assert.deepEqual(contribution.entities.map(({ id }) => id), ACADEMY_LESSONS.map(({ id }) => id));
  assert.equal(contribution.simulation, true);
  assert.equal(Object.isFrozen(contribution), true);
});

test("Academy progression rewards a first answer and reduces a correct retry", () => {
  const start = createAcademyState();
  const firstCorrect = answerAcademyLesson(start, 0);
  assert.equal(firstCorrect.xp, 30);
  assert.deepEqual(firstCorrect.completedLessonIds, ["academy:financial-os"]);
  const duplicate = answerAcademyLesson(firstCorrect, 0);
  assert.equal(duplicate.xp, 30, "a completed lesson cannot mint more demo XP");

  const httpLesson = selectAcademyLesson(duplicate, "academy:http-402");
  const wrong = answerAcademyLesson(httpLesson, 0);
  assert.equal(wrong.xp, 30);
  assert.equal(wrong.trace.at(-1).correct, false);
  const retry = answerAcademyLesson(wrong, 1);
  assert.equal(retry.xp, 45);
  assert.equal(retry.trace.at(-1).award, 15);
  assert.equal(retry.persistence, false);
  assert.equal(retry.externalNetwork, false);
});

test("Academy console is navigable, retryable, resettable, and projection-readable", () => {
  const documentRoot = documentFixture();
  const changes = [];
  const consoleView = createAcademyConsole({ documentRoot, onChange: (snapshot) => changes.push(snapshot) });
  assert.equal(consoleView.getSnapshot().opened, false);
  consoleView.open("test");
  consoleView.select("academy:t402", "test");
  consoleView.answer(2, "test");
  assert.equal(consoleView.getSnapshot().completedCount, 1);
  assert.equal(consoleView.getSnapshot().xp, 30);
  consoleView.reset("test");
  assert.equal(consoleView.getSnapshot().completedCount, 0);
  assert.equal(changes.every((entry) => entry.localOnly && !entry.persistence && !entry.externalNetwork), true);
});

test("Academy source and markup retain the educational authority boundary", async () => {
  const domain = await readFile(new URL("../src/domains/academy.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/academy.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="academy-console"/);
  assert.match(html, /Wrong answers can be retried/i);
  assert.match(html, /Demo XP is not a token/i);
  assert.match(html, /body\.cube-substrate-mode #academy-console\{max-height:calc\(100vh - 340px\)\}/);
  assert.doesNotMatch(domain + renderer, /\bfetch\s*\(|\beval\s*\(|\bimport\s*\(/i);
});
