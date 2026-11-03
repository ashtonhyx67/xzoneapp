// The personality quiz: its questions, its scoring, and the sixteen types.
//
// Everything that decides someone's result lives here, on the server. The app
// only ever sees the wording, so there is one place to change a question and no
// way for an out-of-date client to score someone differently.
//
// It is written for a church family, and for a phone in someone's hand between
// other things, so it stays small and plain:
//
//   - Twelve questions, three on each dimension, and one tap each. Nothing gets
//     added at the end, and nothing asks how strongly someone feels about it.
//   - Each question sets two ordinary, good things against each other, rather
//     than asking "do you agree?". Neither side is meant to be the more loving
//     or the more spiritual one, so nobody has to pick what they think they
//     should say.
//   - Three answers to a dimension can never tie, so every result is defined
//     without a tiebreak round.
//   - Each dimension swaps its sides on one question in three. Tapping the same
//     side all the way down therefore gives only the mildest lean, and is
//     flagged on the result.
//
// Twelve questions make a conversation starter rather than an instrument, which
// is what the quiz's intro tells people. Every answer is kept all the same: see
// personality_results in db.js.

// Bump when a question changes meaning, so answers given to different wording
// are never read as though they were the same question.
const QUIZ_VERSION = 2;

// The first pole of each dimension scores positive.
const DIMENSIONS = [
  { key: "EI", poles: ["E", "I"], labels: ["Outgoing", "Reflective"] },
  { key: "SN", poles: ["S", "N"], labels: ["Practical", "Imaginative"] },
  { key: "TF", poles: ["T", "F"], labels: ["Logic-led", "Heart-led"] },
  { key: "JP", poles: ["J", "P"], labels: ["Planner", "Spontaneous"] },
];

const DIMENSION_BY_KEY = new Map(DIMENSIONS.map((d) => [d.key, d]));

// Almost every answer on the same side is not a personality. This is what lets
// the result say why it may not mean much.
const SAME_ANSWER_LIMIT = 0.85;

// An answer is which option someone tapped: -1 is option a, +1 is option b.
// `left` is the pole of option a; option b is the other one.
const BANK = {
  EI: [
    { id: "ei1", left: "E", prompt: "After a full Sunday, what fills you back up?", a: "Lunch with the whole gang", b: "Some quiet time to myself" },
    { id: "ei2", left: "I", prompt: "A new friend visits CG for the first time.", a: "I smile, and chat when the moment comes", b: "I head straight over to say hi" },
    { id: "ei3", left: "E", prompt: "When something is on your heart…", a: "I talk it through with someone", b: "I sit with it quietly first" },
  ],
  SN: [
    { id: "sn1", left: "N", prompt: "Listening to a sermon, what stays with you most?", a: "The big idea, and where it could lead", b: "The real-life examples and practical steps" },
    { id: "sn2", left: "S", prompt: "Your CG is planning something new. You first ask…", a: "What do we need to make it happen?", b: "What could this grow into?" },
    { id: "sn3", left: "N", prompt: "When you serve, you enjoy…", a: "Dreaming up fresh ways to do things", b: "Doing it well, the way that's proven to work" },
  ],
  TF: [
    { id: "tf1", left: "T", prompt: "A friend shares a struggle with you. You want to…", a: "Help them think through what to do", b: "Simply be there and listen" },
    { id: "tf2", left: "F", prompt: "Someone on your team makes a mistake.", a: "I check how they're doing first", b: "I help them see what to fix first" },
    { id: "tf3", left: "T", prompt: "When you have a hard call to make, you lean on…", a: "What's fair and makes the most sense", b: "How it will affect each person" },
  ],
  JP: [
    { id: "jp1", left: "P", prompt: "Packing for church camp, you're…", a: "Good to go with a quick pack the night before", b: "Ticking off a list a few days ahead" },
    { id: "jp2", left: "J", prompt: "You have a free Sunday afternoon. You'd like…", a: "A plan for how to spend it", b: "To see where the day takes you" },
    { id: "jp3", left: "P", prompt: "The plan changes just before an event.", a: "No problem, let's roll with it", b: "I'll take a moment to re-plan" },
  ],
};

const ALL_QUESTIONS = DIMENSIONS.flatMap((d) =>
  BANK[d.key].map((question) => ({ ...question, dim: d.key }))
);
const QUESTION_BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

// Dealt out one from each dimension in turn, so the quiz never spends several
// questions in a row visibly on the same thing.
const CORE_QUESTIONS = BANK.EI.flatMap((_, i) =>
  DIMENSIONS.map((d) => QUESTION_BY_ID.get(BANK[d.key][i].id))
);

// The app gets the wording only, never which pole a side belongs to.
function publicQuestion(q) {
  return { id: q.id, prompt: q.prompt, a: q.a, b: q.b };
}

// `animal`, `title` and `blurb` are what someone sees as their result, so each
// one says what this person brings to the people around them. Every type is
// meant to read as good news.
const TYPES = {
  ISTJ: {
    animal: "German Shepherd",
    title: "The Steady Guardian",
    blurb: "Loyal, faithful, attentive, and quietly dependable. You're the friend who turns up early, remembers what everyone forgot, and makes sure it's done properly. People rest easier because you're there. 🙌",
  },
  ISFJ: {
    animal: "Elephant",
    title: "The Gentle Keeper",
    blurb: "Caring, patient, thoughtful, and never forgetful of a person. You remember the allergies, the birthdays, and the prayer request from months ago, and you've already packed a snack. You make people feel known. 🥹",
  },
  INFJ: {
    animal: "Whale",
    title: "The Deep Listener",
    blurb: "Insightful, gentle, sincere, and much deeper than you look. You may say only a few words all night, but they're the ones someone carries home. You help people feel truly understood. 🌊",
  },
  INTJ: {
    animal: "Owl",
    title: "The Quiet Strategist",
    blurb: "Thoughtful, sharp, far-sighted, and determined. You see where things are heading long before anyone else, and you've quietly worked out how to get there. Your wisdom helps everyone walk with confidence. 🌟",
  },
  ISTP: {
    animal: "Cat",
    title: "The Calm Fixer",
    blurb: "Calm, capable, curious, and steady under pressure. When something goes wrong you don't panic; you roll up your sleeves and sort it out with whatever is at hand. You're a peaceful presence when it counts. 🛠️",
  },
  ISFP: {
    animal: "Rabbit",
    title: "The Soft Artist",
    blurb: "Gentle, observant, warm, and quietly full of beauty. You notice what others walk past, and you make every space and every moment a little lovelier. Your kindness speaks without needing to be loud. 🌷",
  },
  INFP: {
    animal: "Deer",
    title: "The Gentle Dreamer",
    blurb: "Tender, imaginative, sincere, and full of hope. You feel things deeply, you believe the best about people, and you hold on to what really matters. You remind everyone around you that people come first. 🕊️",
  },
  INTP: {
    animal: "Octopus",
    title: "The Curious Tinkerer",
    blurb: "Inventive, logical, curious, and always asking why. You love getting to the bottom of how things work, and your questions help everyone think more clearly. Your mind is a gift to any team. 💡",
  },
  ESTP: {
    animal: "Cheetah",
    title: "The Quick Mover",
    blurb: "Bold, energetic, practical, and already on the way. You're the first to say yes and the first to jump in when something needs doing. Your courage gets everyone else moving too. ⚡",
  },
  ESFP: {
    animal: "Parrot",
    title: "The Joy Bringer",
    blurb: "Bright, playful, generous, and impossible to miss. You make newcomers feel at home in minutes, and a room feels lighter once you've walked into it. Your joy is contagious, so keep spreading it. 🥳",
  },
  ENFP: {
    animal: "Otter",
    title: "The Bright Spark",
    blurb: "Warm, curious, playful, and excited about absolutely everything. You see the potential in people, make friends in any queue, and leave everyone more hopeful than you found them. 🤩",
  },
  ENTP: {
    animal: "Fox",
    title: "The Curious Challenger",
    blurb: "Quick, witty, inventive, and full of new angles. You ask the question nobody else thought of, and you help the whole group see what else could be possible. Your ideas keep everyone growing. 🚀",
  },
  ESTJ: {
    animal: "Beaver",
    title: "The Faithful Builder",
    blurb: "Organised, direct, hardworking, and reliable. You set up the group chat, draw up the plan, and make sure it all gets done by Thursday. Good things get built because you stick at them. 📋",
  },
  ESFJ: {
    animal: "Golden Retriever",
    title: "The Heart of the Group",
    blurb: "Friendly, loyal, attentive, and thrilled that you came. You check that everyone got home safe, remember how they take their kopi, and make people feel like family. 🥰",
  },
  ENFJ: {
    animal: "Dolphin",
    title: "The Team Lifter",
    blurb: "Warm, expressive, encouraging, and always bringing others along. You believe in people before they believe in themselves, and you help them step into more than they thought they could do. 🫶",
  },
  ENTJ: {
    animal: "Lion",
    title: "The Visionary Leader",
    blurb: "Decisive, confident, courageous, and full of vision. You see what could be, call people towards it, and take the first step yourself. People are braver when you lead the way. 🔥",
  },
};

function typeInfo(code) {
  const info = TYPES[code];
  return info ? { code, ...info } : null;
}

// Answers towards one dimension's first pole count as positive.
function rawScore(dim, answers) {
  const [firstPole] = DIMENSION_BY_KEY.get(dim).poles;
  let total = 0;
  let count = 0;

  for (const q of ALL_QUESTIONS) {
    if (q.dim !== dim || answers[q.id] === undefined) continue;
    const towardsFirst = q.left === firstPole ? -answers[q.id] : answers[q.id];
    total += towardsFirst;
    count += 1;
  }

  return count === 0 ? 0 : total / count;
}

function sameAnswerShare(answers) {
  const values = Object.values(answers);
  if (values.length === 0) return 0;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Math.max(...counts.values()) / values.length;
}

// Throws away anything that is not an answer to a real question.
function cleanAnswers(raw) {
  const answers = {};
  for (const [id, value] of Object.entries(raw || {})) {
    if (!QUESTION_BY_ID.has(id)) continue;
    if (value === -1 || value === 1) answers[id] = value;
  }
  return answers;
}

// Scores a finished quiz. Nothing is held on the server before then, so someone
// can leave partway and carry on from the answers saved on their device.
//
//   { status: "incomplete", missing }        questions are unanswered
//   { status: "done", ...result }            the result
function evaluate({ answers: rawAnswers }) {
  const answers = cleanAnswers(rawAnswers);

  const missing = CORE_QUESTIONS.filter((q) => answers[q.id] === undefined);
  if (missing.length > 0) return { status: "incomplete", missing: missing.map((q) => q.id) };

  const scores = {};
  let type = "";

  for (const d of DIMENSIONS) {
    const score = rawScore(d.key, answers);
    type += score > 0 ? d.poles[0] : d.poles[1];
    // -100 (all second pole) to 100 (all first pole).
    scores[d.key] = { score: Math.round(score * 100) };
  }

  return {
    status: "done",
    type,
    scores,
    answers,
    // Worth telling someone, because it means this result says little about them.
    careless: sameAnswerShare(answers) >= SAME_ANSWER_LIMIT,
  };
}

// The bars on the result screen, in display order: which way each one leans and
// by how much. Worked out from a stored score so old results keep rendering,
// including the close calls the longer version of this quiz could produce.
function publicResult({ type, scores, careless, takenAt }) {
  return {
    ...typeInfo(type),
    careless: Boolean(careless),
    takenAt: takenAt ?? null,
    dimensions: DIMENSIONS.map((d, i) => {
      const entry = scores?.[d.key] || { score: 0 };
      return {
        key: d.key,
        labels: d.labels,
        // Follows the type rather than the sign of the score, so a close call
        // someone settled themselves shows the side they settled on.
        side: type[i] === d.poles[0] ? "first" : "second",
        strength: Math.abs(entry.score),
        close: Boolean(entry.close),
        chosen: Boolean(entry.chosen),
      };
    }),
  };
}

function isValidType(code) {
  return Object.prototype.hasOwnProperty.call(TYPES, code);
}

module.exports = {
  QUIZ_VERSION,
  DIMENSIONS,
  ALL_QUESTIONS,
  CORE_QUESTIONS,
  TYPES,
  evaluate,
  rawScore,
  typeInfo,
  publicQuestion,
  publicResult,
  isValidType,
};
