const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIMENSIONS,
  ALL_QUESTIONS,
  CORE_QUESTIONS,
  TYPES,
  evaluate,
  publicResult,
} = require("./personality");

// Answers as someone who sits firmly on these poles would give them.
function answersFor(type, strength = 2, questions = ALL_QUESTIONS) {
  const answers = {};
  for (const q of questions) {
    const dimIndex = DIMENSIONS.findIndex((d) => d.key === q.dim);
    answers[q.id] = q.left === type[dimIndex] ? -strength : strength;
  }
  return answers;
}

// Every dimension scored exactly dead level: half the questions each way.
function levelAnswers(questions) {
  const answers = {};
  const seen = {};
  for (const q of questions) {
    seen[q.dim] = (seen[q.dim] || 0) + 1;
    const towardsFirst = seen[q.dim] % 2 === 0;
    const first = DIMENSIONS.find((d) => d.key === q.dim).poles[0];
    answers[q.id] = (q.left === first) === towardsFirst ? -2 : 2;
  }
  return answers;
}

const allTiebreakers = ALL_QUESTIONS.filter((q) => q.tiebreak);

test("each dimension has twelve questions and four tiebreakers", () => {
  for (const d of DIMENSIONS) {
    const set = ALL_QUESTIONS.filter((q) => q.dim === d.key);
    assert.equal(set.filter((q) => !q.tiebreak).length, 12, d.key);
    assert.equal(set.filter((q) => q.tiebreak).length, 4, d.key);
  }
});

test("each pole is on the left exactly half the time", () => {
  for (const d of DIMENSIONS) {
    for (const tiebreak of [false, true]) {
      const set = ALL_QUESTIONS.filter((q) => q.dim === d.key && Boolean(q.tiebreak) === tiebreak);
      const left = set.filter((q) => q.left === d.poles[0]).length;
      assert.equal(left, set.length / 2, `${d.key} tiebreak=${tiebreak}`);
    }
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

test("the core quiz deals the dimensions out in turn", () => {
  assert.equal(CORE_QUESTIONS.length, 48);
  CORE_QUESTIONS.forEach((q, i) => assert.equal(q.dim, DIMENSIONS[i % 4].key));
});

test("sixteen types, each named", () => {
  assert.equal(Object.keys(TYPES).length, 16);
  for (const info of Object.values(TYPES)) assert.ok(info.animal && info.title && info.blurb);
  assert.equal(new Set(Object.values(TYPES).map((t) => t.animal)).size, 16);
});

test("clear answers come back as every one of the sixteen types", () => {
  for (const type of Object.keys(TYPES)) {
    const result = evaluate({ answers: answersFor(type, 2, CORE_QUESTIONS) });
    assert.equal(result.status, "done", type);
    assert.equal(result.type, type);
    assert.equal(result.measuredType, type);
    for (const d of DIMENSIONS) {
      assert.equal(Math.abs(result.scores[d.key].score), 100);
      assert.equal(result.scores[d.key].close, false);
    }
  }
});

test("a mild leaning still finds the type, without inflating it", () => {
  const result = evaluate({ answers: answersFor("ENFP", 1, CORE_QUESTIONS) });
  assert.equal(result.type, "ENFP");
  assert.equal(result.scores.EI.score, 50);
  assert.equal(result.scores.SN.score, -50);
});

test("unanswered core questions are reported, not guessed", () => {
  const answers = answersFor("ISTJ", 2, CORE_QUESTIONS);
  delete answers.jp03;
  assert.deepEqual(evaluate({ answers }), { status: "incomplete", missing: ["jp03"] });
});

test("answers outside the scale, or to no real question, are ignored", () => {
  const answers = { ...answersFor("ISTJ", 2, CORE_QUESTIONS), ei01: 50, sn01: "2", nope: 2 };
  const result = evaluate({ answers });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["ei01", "sn01"]);
});

test("a close dimension gets its four tiebreakers, and only that one", () => {
  const answers = { ...answersFor("ISTJ", 2, CORE_QUESTIONS) };
  const level = levelAnswers(CORE_QUESTIONS);
  for (const q of CORE_QUESTIONS.filter((q) => q.dim === "JP")) answers[q.id] = level[q.id];

  const step = evaluate({ answers });
  assert.equal(step.status, "more");
  assert.deepEqual(
    step.questions.map((q) => q.id),
    ["jp13", "jp14", "jp15", "jp16"]
  );
});

test("the wording sent to the app does not give away the scoring", () => {
  const answers = levelAnswers(CORE_QUESTIONS);
  const { questions } = evaluate({ answers });
  for (const q of questions) assert.deepEqual(Object.keys(q).sort(), ["a", "b", "id", "prompt"]);
});

test("half-answered tiebreakers are asked again rather than scored", () => {
  const answers = levelAnswers(CORE_QUESTIONS);
  for (const q of allTiebreakers) answers[q.id] = 2;
  delete answers.tf14;
  const step = evaluate({ answers });
  assert.equal(step.status, "more");
  assert.deepEqual(
    step.questions.map((q) => q.id),
    ["tf14"]
  );
});

test("tiebreakers can settle a close call on their own", () => {
  const answers = { ...answersFor("ISTJ", 2, CORE_QUESTIONS) };
  const level = levelAnswers(CORE_QUESTIONS);
  for (const q of CORE_QUESTIONS.filter((q) => q.dim === "JP")) answers[q.id] = level[q.id];
  Object.assign(answers, answersFor("ISTP", 2, allTiebreakers.filter((q) => q.dim === "JP")));

  const result = evaluate({ answers });
  assert.equal(result.status, "done");
  assert.equal(result.type, "ISTP");
  assert.equal(result.scores.JP.chosen, false);
});

test("still level after the tiebreakers, the person decides", () => {
  const answers = levelAnswers(ALL_QUESTIONS);

  const step = evaluate({ answers });
  assert.equal(step.status, "choose");
  assert.deepEqual(
    step.dimensions.map((d) => d.key),
    ["EI", "SN", "TF", "JP"]
  );

  const result = evaluate({ answers, choices: { EI: "E", SN: "S", TF: "T", JP: "J" } });
  assert.equal(result.status, "done");
  assert.equal(result.type, "ESTJ");
  // What the answers alone said is kept beside what the person settled on.
  assert.equal(result.measuredType, "INFP");
  assert.equal(result.scores.JP.chosen, true);
});

test("a choice cannot override a dimension that was not close", () => {
  const answers = answersFor("ISTJ", 2, CORE_QUESTIONS);
  const result = evaluate({ answers, choices: { EI: "E", JP: "P" } });
  assert.equal(result.type, "ISTJ");
  assert.deepEqual(result.choices, {});
});

test("a choice has to be one of the two poles", () => {
  const answers = levelAnswers(ALL_QUESTIONS);
  const step = evaluate({ answers, choices: { EI: "X", SN: "S", TF: "T", JP: "J" } });
  assert.equal(step.status, "choose");
  assert.deepEqual(step.dimensions.map((d) => d.key), ["EI"]);
});

test("tapping the same dot all the way down gives no confident answer", () => {
  for (const value of [-2, -1, 1, 2]) {
    const answers = Object.fromEntries(ALL_QUESTIONS.map((q) => [q.id, value]));
    const step = evaluate({ answers });
    assert.equal(step.status, "choose", `value ${value}`);
    assert.equal(step.dimensions.length, 4);

    const result = evaluate({ answers, choices: { EI: "I", SN: "S", TF: "T", JP: "J" } });
    assert.equal(result.careless, true);
    for (const d of DIMENSIONS) assert.equal(result.scores[d.key].score, 0);
  }
});

test("real answers are not flagged as careless", () => {
  const result = evaluate({ answers: answersFor("ISTJ", 2, CORE_QUESTIONS) });
  assert.equal(result.careless, false);
});

test("the result lists its bars in order, leaning the right way", () => {
  const { type, scores, careless } = evaluate({
    answers: answersFor("ISTJ", 2, CORE_QUESTIONS),
  });
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
