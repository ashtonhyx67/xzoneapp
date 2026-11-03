const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIMENSIONS,
  ALL_QUESTIONS,
  CORE_QUESTIONS,
  TYPES,
  evaluate,
  publicResult,
  publicQuestion,
} = require("./personality");

// Answers as someone who sits firmly on these poles would give them.
function answersFor(type) {
  const answers = {};
  for (const q of ALL_QUESTIONS) {
    const dimIndex = DIMENSIONS.findIndex((d) => d.key === q.dim);
    answers[q.id] = q.left === type[dimIndex] ? -1 : 1;
  }
  return answers;
}

test("twelve questions, three on each dimension", () => {
  assert.equal(CORE_QUESTIONS.length, 12);
  assert.equal(ALL_QUESTIONS.length, 12);
  for (const d of DIMENSIONS) {
    assert.equal(ALL_QUESTIONS.filter((q) => q.dim === d.key).length, 3, d.key);
  }
});

test("each dimension swaps its sides, so no pole always sits on one side", () => {
  for (const d of DIMENSIONS) {
    const set = ALL_QUESTIONS.filter((q) => q.dim === d.key);
    const left = set.filter((q) => q.left === d.poles[0]).length;
    assert.ok(left === 1 || left === 2, d.key);
  }
});

test("question ids are unique, and every question has both sides", () => {
  const ids = ALL_QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const q of ALL_QUESTIONS) {
    assert.ok(q.prompt && q.a && q.b, q.id);
    assert.notEqual(q.a, q.b, q.id);
    assert.ok(DIMENSIONS.find((d) => d.key === q.dim).poles.includes(q.left), q.id);
  }
});

test("the quiz deals the dimensions out in turn", () => {
  CORE_QUESTIONS.forEach((q, i) => assert.equal(q.dim, DIMENSIONS[i % 4].key));
});

test("sixteen types, each named", () => {
  assert.equal(Object.keys(TYPES).length, 16);
  for (const info of Object.values(TYPES)) assert.ok(info.animal && info.title && info.blurb);
  assert.equal(new Set(Object.values(TYPES).map((t) => t.animal)).size, 16);
});

test("clear answers come back as every one of the sixteen types", () => {
  for (const type of Object.keys(TYPES)) {
    const result = evaluate({ answers: answersFor(type) });
    assert.equal(result.status, "done", type);
    assert.equal(result.type, type);
    for (const d of DIMENSIONS) assert.equal(Math.abs(result.scores[d.key].score), 100);
  }
});

test("two answers out of three decide a dimension, and show as a lean", () => {
  const answers = answersFor("ENFP");
  answers.ei1 = -answers.ei1;
  const result = evaluate({ answers });
  assert.equal(result.type, "ENFP");
  assert.equal(result.scores.EI.score, 33);
});

test("unanswered questions are reported, not guessed", () => {
  const answers = answersFor("ISTJ");
  delete answers.jp3;
  assert.deepEqual(evaluate({ answers }), { status: "incomplete", missing: ["jp3"] });
});

test("answers outside the two options, or to no real question, are ignored", () => {
  const answers = { ...answersFor("ISTJ"), ei1: 2, sn1: "1", tf1: 0, nope: 1 };
  const result = evaluate({ answers });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["ei1", "sn1", "tf1"]);
});

test("the wording sent to the app does not give away the scoring", () => {
  for (const q of CORE_QUESTIONS) {
    assert.deepEqual(Object.keys(publicQuestion(q)).sort(), ["a", "b", "id", "prompt"]);
  }
});

test("tapping the same side all the way down gives only a mild, flagged lean", () => {
  for (const value of [-1, 1]) {
    const answers = Object.fromEntries(ALL_QUESTIONS.map((q) => [q.id, value]));
    const result = evaluate({ answers });
    assert.equal(result.status, "done");
    assert.equal(result.careless, true);
    for (const d of DIMENSIONS) assert.equal(Math.abs(result.scores[d.key].score), 33);
  }
});

test("no firm type is mistaken for careless tapping", () => {
  for (const type of Object.keys(TYPES)) {
    assert.equal(evaluate({ answers: answersFor(type) }).careless, false, type);
  }
});

test("the result lists its bars in order, leaning the right way", () => {
  const { type, scores, careless } = evaluate({ answers: answersFor("ISTJ") });
  const shown = publicResult({ type, scores, careless });

  assert.equal(shown.animal, "German Shepherd");
  assert.deepEqual(
    shown.dimensions.map((d) => [d.key, d.side, d.strength]),
    [
      ["EI", "second", 100],
      ["SN", "first", 100],
      ["TF", "first", 100],
      ["JP", "first", 100],
    ]
  );
});

test("a result from the longer quiz still draws, close calls and all", () => {
  const shown = publicResult({
    type: "ESTJ",
    scores: {
      EI: { score: -4, close: true, chosen: true },
      SN: { score: 60, close: false, chosen: false },
      TF: { score: 30, close: false, chosen: false },
      JP: { score: 15, close: true, chosen: false },
    },
    careless: false,
  });

  assert.equal(shown.dimensions[0].side, "first");
  assert.equal(shown.dimensions[0].chosen, true);
  assert.equal(shown.dimensions[3].close, true);
});
