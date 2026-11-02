// The personality quiz: its questions, its scoring, and the sixteen types.
//
// Everything that decides someone's result lives here, on the server. The app
// only ever sees the wording, so there is one place to change a question and no
// way for an out-of-date client to score someone differently.
//
// How it tries to get the answer right:
//
//   - Each question sets two ordinary behaviours against each other, rather than
//     asking "do you agree?". People agree with most statements about themselves,
//     and a pair takes that habit out of the result.
//   - Both sides are meant to sound equally fine. Nobody should be able to pick
//     the answer they wish were true just because the other one sounds worse.
//   - Each dimension has twelve questions spread over its different facets, half
//     with each pole on the left. Tapping the same side all the way down therefore
//     cancels out to nothing instead of producing a confident wrong answer.
//   - A dimension that comes out close gets four more questions. If it is still
//     close, the person reads both sides and says which one is them, which is how
//     the published instruments settle a borderline result too.
//
// None of this has been validated against real respondents yet. Every answer is
// kept so that it can be: see personality_results in db.js.

// Bump when a question changes meaning, so answers given to different wording
// are never read as though they were the same question.
const QUIZ_VERSION = 1;

// The first pole of each dimension scores positive.
const DIMENSIONS = [
  { key: "EI", poles: ["E", "I"], labels: ["Outgoing", "Reflective"] },
  { key: "SN", poles: ["S", "N"], labels: ["Practical", "Imaginative"] },
  { key: "TF", poles: ["T", "F"], labels: ["Logic-led", "Heart-led"] },
  { key: "JP", poles: ["J", "P"], labels: ["Planner", "Spontaneous"] },
];

const DIMENSION_BY_KEY = new Map(DIMENSIONS.map((d) => [d.key, d]));

// An answer is how far along the line between the two options someone landed:
// -2 is all the way to the left option, +2 all the way to the right.
const MAX_ANSWER = 2;

// Below this the first twelve answers have not really separated the two poles.
const EXTRA_QUESTIONS_BELOW = 0.2;
// Below this, sixteen answers still have not, and more questions would not help.
const SELF_CHOICE_BELOW = 0.1;

// Almost every answer the same is not a personality. With the poles balanced it
// scores near the middle anyway; this is what lets the result say why.
const SAME_ANSWER_LIMIT = 0.85;

// `left` is the pole of option a; option b is the other one. `tiebreak` questions
// are only asked when a dimension comes out close.
const BANK = {
  EI: [
    { id: "ei01", left: "E", prompt: "After a long, busy week, what actually recharges you?", a: "Going out and seeing people", b: "A quiet evening on my own" },
    { id: "ei02", left: "I", prompt: "You walk into a room where you know almost nobody.", a: "I wait for someone to come and talk to me", b: "I go up and introduce myself" },
    { id: "ei03", left: "E", prompt: "When you're working through a problem…", a: "I talk it out to figure out what I think", b: "I think it through alone first" },
    { id: "ei04", left: "I", prompt: "A free Saturday. You'd rather spend it…", a: "With one or two close friends", b: "With a big group" },
    { id: "ei05", left: "E", prompt: "In a group discussion…", a: "I speak up early, even before I've worked it all out", b: "I listen first and speak once I'm sure what to say" },
    { id: "ei06", left: "I", prompt: "People who've just met you would probably say you're…", a: "Hard to read at first", b: "Easy to get to know" },
    { id: "ei07", left: "E", prompt: "Something exciting just happened to you.", a: "I want to tell people straight away", b: "I keep it to myself for a while" },
    { id: "ei08", left: "I", prompt: "After a full day around people, you feel…", a: "Ready for some time alone", b: "Still buzzing and up for more" },
    { id: "ei09", left: "E", prompt: "You've had an idea for something new.", a: "I try it and see what happens", b: "I turn it over in my head first" },
    { id: "ei10", left: "I", prompt: "At a meal with people you've just met…", a: "I mostly listen and answer questions", b: "I help keep the conversation going" },
    { id: "ei11", left: "E", prompt: "Catching up with a friend, you'd rather…", a: "Call or meet up", b: "Text when we both have time" },
    { id: "ei12", left: "I", prompt: "How many people know what's going on in your life?", a: "Just a few", b: "Quite a lot" },

    { id: "ei13", left: "E", tiebreak: true, prompt: "Someone new joins your group.", a: "I go and say hi first", b: "I say hi when we end up next to each other" },
    { id: "ei14", left: "I", tiebreak: true, prompt: "A weekend of back-to-back plans with people sounds…", a: "Tiring just thinking about it", b: "Like a great weekend" },
    { id: "ei15", left: "E", tiebreak: true, prompt: "You understand something best after…", a: "Talking it over with people", b: "Reading or thinking about it alone" },
    { id: "ei16", left: "I", tiebreak: true, prompt: "In a crowded, noisy place, after a while you…", a: "Start to feel drained", b: "Feel more awake" },
  ],
  SN: [
    { id: "sn01", left: "S", prompt: "When someone gives you directions, you want…", a: "The exact steps, turn by turn", b: "The general idea, and you'll work out the rest" },
    { id: "sn02", left: "N", prompt: "Watching a film, you tend to notice…", a: "What it's really about underneath", b: "The details and what actually happens" },
    { id: "sn03", left: "S", prompt: "You enjoy learning most when it's…", a: "Something I can use straight away", b: "The idea behind why something works" },
    { id: "sn04", left: "N", prompt: "You spend more of your time thinking about…", a: "What could happen one day", b: "What's happening right now" },
    { id: "sn05", left: "S", prompt: "When you explain something to someone…", a: "I give facts and real examples", b: "I use comparisons and the big picture" },
    { id: "sn06", left: "N", prompt: "Your friends are more likely to describe you as…", a: "Full of ideas", b: "Down to earth" },
    { id: "sn07", left: "S", prompt: "Trying a new recipe, you'd…", a: "Follow it, because it's meant to work", b: "Change things to see what it could become" },
    { id: "sn08", left: "N", prompt: "When your mind wanders, it goes to…", a: "What-ifs and things that don't exist yet", b: "What's around me and what needs doing" },
    { id: "sn09", left: "S", prompt: "You hear about a new plan. Your first question is…", a: "How will this actually work?", b: "What could this turn into?" },
    { id: "sn10", left: "N", prompt: "Telling someone about a holiday, you talk about…", a: "How it felt and what it made you think", b: "Where you went and what you did" },
    { id: "sn11", left: "S", prompt: "You trust more in…", a: "What I've seen and tried myself", b: "My sense of how things connect" },
    { id: "sn12", left: "N", prompt: "With a song you like, you're drawn to…", a: "What the lyrics might be hinting at", b: "The sound, and the words as they are" },

    { id: "sn13", left: "S", tiebreak: true, prompt: "The conversations you enjoy most are about…", a: "Real things: people, plans, what happened", b: "Ideas: theories, possibilities, meanings" },
    { id: "sn14", left: "N", tiebreak: true, prompt: "A task comes up again that you've done before.", a: "I look for a new way of doing it", b: "I use the way I know works" },
    { id: "sn15", left: "S", tiebreak: true, prompt: "Thinking back on an event, you remember…", a: "Specifics, like what people said", b: "The overall impression it left" },
    { id: "sn16", left: "N", tiebreak: true, prompt: "You prefer a teacher who…", a: "Gets you thinking about what's possible", b: "Shows you clearly how it's done" },
  ],
  TF: [
    { id: "tf01", left: "T", prompt: "A friend tells you about a problem they're having.", a: "I help them work out how to fix it", b: "I make sure they feel heard first" },
    { id: "tf02", left: "F", prompt: "Making a big decision, what counts most?", a: "How it will affect the people involved", b: "What makes the most sense once it's weighed up" },
    { id: "tf03", left: "T", prompt: "A teammate's work has a mistake in it.", a: "I point it out plainly so it gets fixed", b: "I think about how to raise it kindly" },
    { id: "tf04", left: "F", prompt: "In a disagreement, you care more about…", a: "Things staying okay between us", b: "Getting to what's actually right" },
    { id: "tf05", left: "T", prompt: "You'd rather be known for being…", a: "Fair and honest", b: "Warm and caring" },
    { id: "tf06", left: "F", prompt: "Someone is upset by a decision that was correct.", a: "I'd look at whether it could change for them", b: "I'd explain why it still stands" },
    { id: "tf07", left: "T", prompt: "When you give someone feedback…", a: "I go straight to what could be better", b: "I start with what they did well" },
    { id: "tf08", left: "F", prompt: "A friend's plan probably won't work.", a: "I back them and help where I can", b: "I tell them where I think it'll go wrong" },
    { id: "tf09", left: "T", prompt: "A rule turns out badly for one person.", a: "It should still apply the same to everyone", b: "Their situation should be an exception" },
    { id: "tf10", left: "F", prompt: "You'd call it a good decision if…", a: "People felt looked after", b: "It solved the problem" },
    { id: "tf11", left: "T", prompt: "When someone disagrees with you…", a: "I'm happy to debate it out", b: "I look for what we can agree on" },
    { id: "tf12", left: "F", prompt: "Which bothers you more?", a: "Someone who's right but harsh about it", b: "Someone who's nice but wrong" },

    { id: "tf13", left: "T", tiebreak: true, prompt: "Choosing between two people for a role, you'd go with…", a: "Whoever has the stronger skills", b: "Whoever would grow most from the chance" },
    { id: "tf14", left: "F", tiebreak: true, prompt: "A friend asks if their outfit looks good. It doesn't.", a: "I find something kind to say about it", b: "I tell them honestly" },
    { id: "tf15", left: "T", tiebreak: true, prompt: "What convinces you most?", a: "A solid argument with evidence", b: "A real story about someone affected" },
    { id: "tf16", left: "F", tiebreak: true, prompt: "There's tension in your team. You start by asking…", a: "How is everyone feeling?", b: "What is the actual issue?" },
  ],
  JP: [
    { id: "jp01", left: "J", prompt: "Going on a trip with friends, you'd like…", a: "A rough itinerary sorted before we leave", b: "To figure it out once we're there" },
    { id: "jp02", left: "P", prompt: "A big assignment is due in two weeks.", a: "Most of the work happens near the deadline", b: "I start early and chip away at it" },
    { id: "jp03", left: "J", prompt: "Which feels better?", a: "Having things settled and decided", b: "Having things open and flexible" },
    { id: "jp04", left: "P", prompt: "For the coming weekend, you'd rather…", a: "Keep it free and see what comes up", b: "Know what I'm doing in advance" },
    { id: "jp05", left: "J", prompt: "Plans change at the last minute.", a: "It throws me off for a bit", b: "No problem, it might even be better" },
    { id: "jp06", left: "P", prompt: "To-do lists…", a: "I rarely bother, or I forget about them", b: "I keep them and like ticking things off" },
    { id: "jp07", left: "J", prompt: "When there's a decision to make…", a: "I like to decide and move on", b: "I keep my options open as long as I can" },
    { id: "jp08", left: "P", prompt: "Working on something big, you…", a: "Jump between parts as you feel like it", b: "Work through it in order" },
    { id: "jp09", left: "J", prompt: "Meeting friends at a set time, you usually…", a: "Plan to get there a little early", b: "Leave when I'm ready and arrive around then" },
    { id: "jp10", left: "P", prompt: "You get an unexpected free afternoon.", a: "I see what I feel like doing", b: "I get ahead on things I need to do" },
    { id: "jp11", left: "J", prompt: "Packing for a trip, you…", a: "Start early, with a list", b: "Throw it together close to leaving" },
    { id: "jp12", left: "P", prompt: "Halfway through a project, someone has a better idea.", a: "Let's work it in, even this late", b: "Let's finish what we agreed on" },

    { id: "jp13", left: "J", tiebreak: true, prompt: "You work best…", a: "At a steady pace, with a plan", b: "In bursts, when the energy is there" },
    { id: "jp14", left: "P", tiebreak: true, prompt: "Friends invite you out tonight, but you had other plans.", a: "I'd probably go, plans can move", b: "I'd stick to what I'd planned" },
    { id: "jp15", left: "J", tiebreak: true, prompt: "When you go shopping…", a: "I go with a list and buy what's on it", b: "I browse and see what I find" },
    { id: "jp16", left: "P", tiebreak: true, prompt: "On your phone or laptop, your files and photos are…", a: "Wherever they ended up", b: "Sorted into places I chose" },
  ],
};

const ALL_QUESTIONS = DIMENSIONS.flatMap((d) =>
  BANK[d.key].map((question) => ({ ...question, dim: d.key }))
);
const QUESTION_BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

// Dealt out one from each dimension in turn, so the quiz never spends several
// questions in a row visibly on the same thing. That also makes a run of answers
// to one dimension harder to steer on purpose.
const CORE_QUESTIONS = BANK.EI.filter((q) => !q.tiebreak).flatMap((_, i) =>
  DIMENSIONS.map((d) => QUESTION_BY_ID.get(BANK[d.key][i].id))
);

function tiebreakers(dim) {
  return ALL_QUESTIONS.filter((q) => q.dim === dim && q.tiebreak);
}

// The app gets the wording only, never which pole a side belongs to.
function publicQuestion(q) {
  return { id: q.id, prompt: q.prompt, a: q.a, b: q.b };
}

// What each pole means, for the moment someone has to choose between two.
const POLE_DESCRIPTIONS = {
  E: "You get energy from being around people. You tend to think out loud, jump in, and find out what you think by talking.",
  I: "You get energy from time alone. You tend to think first, share with a few people, and go deep rather than wide.",
  S: "You trust what's real and in front of you. You notice details, like what's proven, and want to know how things actually work.",
  N: "You're drawn to patterns and possibilities. You read between the lines, get bored by routine, and like what could be.",
  T: "You decide by weighing things up. You'd rather be fair and straight with someone, even if it isn't what they want to hear.",
  F: "You decide by thinking about the people involved. You'd rather keep things kind and whole, even when the logic points elsewhere.",
  J: "You like things settled. You plan ahead, finish before the deadline, and feel better once a decision has been made.",
  P: "You like things open. You go with the flow, do your best work close to the deadline, and keep your options for as long as you can.",
};

// `animal`, `title` and `blurb` are what someone sees as their result.
const TYPES = {
  ISTJ: {
    animal: "German Shepherd",
    title: "The Steady Guardian",
    blurb: "Loyal, attentive, disciplined, protective, and quietly dependable. The friend who remembered the meeting time, brought what everyone forgot, and is silently wondering why nobody else read the instructions. 😭",
  },
  ISFJ: {
    animal: "Elephant",
    title: "The Gentle Keeper",
    blurb: "Caring, patient, thoughtful, steady, and impossible to forget about. The friend who remembers your allergies, your mum's birthday, and that thing you said in 2019, and has already packed you a snack. 🥹",
  },
  INFJ: {
    animal: "Whale",
    title: "The Deep Listener",
    blurb: "Insightful, private, gentle, idealistic, and much deeper than they look. The friend who said four words all night, then sent a text that explained your entire life back to you. 🫠",
  },
  INTJ: {
    animal: "Owl",
    title: "The Quiet Strategist",
    blurb: "Independent, sharp, far-sighted, determined, and rarely surprised. The friend who saw this coming three months ago, already has a plan, and is just waiting for the rest of you to catch up. 🙂",
  },
  ISTP: {
    animal: "Cat",
    title: "The Cool Fixer",
    blurb: "Calm, capable, curious, independent, and unbothered by almost everything. The friend who says nothing during the crisis, fixes it with whatever was lying around, and then leaves without telling anyone. 😼",
  },
  ISFP: {
    animal: "Rabbit",
    title: "The Soft Artist",
    blurb: "Gentle, observant, easygoing, warm, and quietly full of taste. The friend whose playlist makes you cry, whose room looks like a magazine, and who needs a three-day rest after your birthday party. 🌷",
  },
  INFP: {
    animal: "Deer",
    title: "The Gentle Dreamer",
    blurb: "Tender, imaginative, sincere, idealistic, and always somewhere else in their head. The friend who feels everything, has a whole novel going on inside, and is still thinking about what you said last Tuesday. 🥲",
  },
  INTP: {
    animal: "Octopus",
    title: "The Curious Tinkerer",
    blurb: "Inventive, logical, absent-minded, curious, and endlessly distracted by how things work. The friend who has eleven tabs open on one question, forgot to eat, and would like to correct one small thing you said. 🤓",
  },
  ESTP: {
    animal: "Cheetah",
    title: "The Quick Mover",
    blurb: "Bold, sharp, energetic, practical, and already halfway there. The friend who said yes before hearing the plan, talked their way out of it twice, and somehow still arrived first. 😎",
  },
  ESFP: {
    animal: "Parrot",
    title: "The Life of the Party",
    blurb: "Bright, playful, generous, spontaneous, and impossible to ignore. The friend who knows everyone at the party, got them all dancing, and will definitely tell you about it again tomorrow. 🥳",
  },
  ENFP: {
    animal: "Otter",
    title: "The Bright Spark",
    blurb: "Warm, curious, playful, excitable, and interested in absolutely everything. The friend with seven new passions this month, who made a best friend in the queue, and has not finished any of the seven. 🤩",
  },
  ENTP: {
    animal: "Fox",
    title: "The Clever Debater",
    blurb: "Quick, witty, inventive, restless, and always up for an argument. The friend who took the other side just to see what would happen, and who is now winning, and enjoying it far too much. 😏",
  },
  ESTJ: {
    animal: "Beaver",
    title: "The No-Nonsense Builder",
    blurb: "Organised, direct, hardworking, reliable, and already onto the next thing. The friend who made the group chat, set the agenda, split the bill to the cent, and got the whole thing done by Thursday. 📋",
  },
  ESFJ: {
    animal: "Golden Retriever",
    title: "The Heart of the Group",
    blurb: "Friendly, loyal, attentive, sociable, and thrilled that you came. The friend who checks everyone got home safe, remembers how you take your kopi, and is genuinely so happy to see you. 🥰",
  },
  ENFJ: {
    animal: "Dolphin",
    title: "The Team Lifter",
    blurb: "Warm, expressive, encouraging, persuasive, and always bringing others along. The friend who believes in you more than you do, knows what everyone needs, and is somehow running the whole thing by accident. 🫶",
  },
  ENTJ: {
    animal: "Lion",
    title: "The Natural Commander",
    blurb: "Decisive, confident, ambitious, strategic, and walking slightly ahead of everyone. The friend who asked one question, took charge by accident, and has a five-year plan for your side project. 💼",
  },
};

function typeInfo(code) {
  const info = TYPES[code];
  return info ? { code, ...info } : null;
}

// Answers towards one dimension's first pole count as positive. Every question
// answered counts, so a dimension that got its tiebreakers is scored on all
// sixteen rather than on the last four.
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

  return count === 0 ? 0 : total / (count * MAX_ANSWER);
}

// A dead heat goes to the second pole of each dimension (I, N, F, P). It rarely
// matters, because the person is asked before it comes to that, but a result has
// to be defined for every set of answers. It is also the published convention.
function measuredPole(dim, score) {
  const [first, second] = DIMENSION_BY_KEY.get(dim).poles;
  return score > 0 ? first : second;
}

function needsTiebreakers(dim, answers) {
  const asked = tiebreakers(dim).some((q) => answers[q.id] !== undefined);
  return !asked && Math.abs(rawScore(dim, answers)) < EXTRA_QUESTIONS_BELOW;
}

function needsChoice(dim, answers) {
  return Math.abs(rawScore(dim, answers)) < SELF_CHOICE_BELOW;
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
    if (Number.isInteger(value) && Math.abs(value) <= MAX_ANSWER) answers[id] = value;
  }
  return answers;
}

// One step of the quiz. Given what has been answered so far it says what is
// needed next. Nothing is held on the server between steps, so someone can leave
// partway and carry on from the answers saved on their device.
//
//   { status: "incomplete" }                 core questions are missing
//   { status: "more", questions }            ask these before scoring
//   { status: "choose", dimensions }         too close; they read both and pick
//   { status: "done", ...result }            the result
function evaluate({ answers: rawAnswers, choices: rawChoices }) {
  const answers = cleanAnswers(rawAnswers);

  const missing = CORE_QUESTIONS.filter((q) => answers[q.id] === undefined);
  if (missing.length > 0) return { status: "incomplete", missing: missing.map((q) => q.id) };

  const more = DIMENSIONS.filter((d) => needsTiebreakers(d.key, answers)).flatMap((d) =>
    tiebreakers(d.key)
  );
  if (more.length > 0) return { status: "more", questions: more.map(publicQuestion) };

  // A tiebreaker that was sent has to come back answered. Without this a client
  // could answer two of the four and be scored on a set nobody designed.
  const partial = DIMENSIONS.flatMap((d) => {
    const set = tiebreakers(d.key);
    const answered = set.filter((q) => answers[q.id] !== undefined);
    return answered.length > 0 && answered.length < set.length
      ? set.filter((q) => answers[q.id] === undefined)
      : [];
  });
  if (partial.length > 0) return { status: "more", questions: partial.map(publicQuestion) };

  const choices = rawChoices || {};
  const unchosen = DIMENSIONS.filter(
    (d) => needsChoice(d.key, answers) && !d.poles.includes(choices[d.key])
  );
  if (unchosen.length > 0) {
    return {
      status: "choose",
      dimensions: unchosen.map((d) => ({
        key: d.key,
        options: d.poles.map((pole, i) => ({
          pole,
          label: d.labels[i],
          description: POLE_DESCRIPTIONS[pole],
        })),
      })),
    };
  }

  const scores = {};
  let measuredType = "";
  let type = "";

  for (const d of DIMENSIONS) {
    const score = rawScore(d.key, answers);
    const measured = measuredPole(d.key, score);
    const chosen = needsChoice(d.key, answers) ? choices[d.key] : null;

    measuredType += measured;
    type += chosen || measured;

    scores[d.key] = {
      // -100 (all second pole) to 100 (all first pole).
      score: Math.round(score * 100),
      close: Math.abs(score) < EXTRA_QUESTIONS_BELOW,
      chosen: Boolean(chosen),
    };
  }

  return {
    status: "done",
    type,
    measuredType,
    scores,
    answers,
    choices: Object.fromEntries(
      DIMENSIONS.filter((d) => scores[d.key].chosen).map((d) => [d.key, choices[d.key]])
    ),
    // Worth telling someone, because it means this result says little about them.
    careless: sameAnswerShare(answers) >= SAME_ANSWER_LIMIT,
  };
}

// The bars on the result screen, in display order: which way each one leans and
// by how much. Worked out from a stored score so old results keep rendering.
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
  MAX_ANSWER,
  evaluate,
  rawScore,
  typeInfo,
  publicQuestion,
  publicResult,
  isValidType,
};
