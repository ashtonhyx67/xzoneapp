import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import AnimalDoodle from "../components/AnimalDoodle.jsx";

// -2 is all the way to the left option, +2 all the way to the right. The server
// knows which pole each side belongs to; this page does not.
const SCALE = [
  { value: -2, label: "Definitely" },
  { value: -1, label: "Mostly" },
  { value: 0, label: "Both" },
  { value: 1, label: "Mostly" },
  { value: 2, label: "Definitely" },
];

// How far a card has to be dragged to count, and to count for more.
const SWIPE_MOSTLY = 50;
const SWIPE_DEFINITELY = 120;

// Long enough to see the answer land before the next card replaces it.
const ADVANCE_MS = 170;

// Five minutes is a long time on a phone, so answers are kept as they are given.
// Keyed by account, since a device can be shared.
function draftKey(userId) {
  return `personalityDraft:${userId}`;
}

function readDraft(userId, version) {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(userId)));
    return draft?.version === version ? draft : null;
  } catch {
    return null;
  }
}

function writeDraft(userId, draft) {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    /* storage unavailable; the quiz still works, it just can't be resumed */
  }
}

function clearDraft(userId) {
  try {
    localStorage.removeItem(draftKey(userId));
  } catch {
    /* nothing to clear */
  }
}

function swipeValue(dx) {
  const distance = Math.abs(dx);
  if (distance < SWIPE_MOSTLY) return null;
  const strength = distance >= SWIPE_DEFINITELY ? 2 : 1;
  return dx < 0 ? -strength : strength;
}

function QuestionCard({ question, value, leaving, onAnswer }) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const dragged = useRef(false);
  const heading = useRef(null);

  // Each card replaces the last, so without this a screen reader is left on
  // nothing after every answer.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  // A vertical move is left to the page, so a long question can still be
  // scrolled on a small phone. touch-action in the stylesheet is the other half.
  function handlePointerDown(event) {
    if (event.button !== 0 || event.target.closest(".quiz-dot")) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    dragged.current = false;
  }

  function handlePointerMove(event) {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;

    const moveX = event.clientX - current.x;
    const moveY = event.clientY - current.y;

    if (!current.active) {
      if (Math.abs(moveX) < 10) {
        if (Math.abs(moveY) > 10) drag.current = null;
        return;
      }
      current.active = true;
      dragged.current = true;
      event.currentTarget.setPointerCapture(current.id);
    }

    setDx(moveX);
  }

  function handlePointerEnd(event) {
    const current = drag.current;
    drag.current = null;
    if (!current?.active) return;

    const answer = event.type === "pointerup" ? swipeValue(dx) : null;
    setDx(0);
    if (answer !== null) onAnswer(answer);
  }

  function tapOption(answer) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onAnswer(answer);
  }

  // While a card is being dragged the page shows where letting go would land.
  const preview = dx === 0 ? null : swipeValue(dx);
  const shown = preview ?? value;

  const leanLeft = shown !== undefined && shown !== null && shown < 0;
  const leanRight = shown !== undefined && shown !== null && shown > 0;

  // The card moves less than the finger does, so the answer being swiped towards
  // stays on screen where it can be read.
  const style =
    dx === 0 ? undefined : { transform: `translateX(${dx * 0.22}px) rotate(${dx * 0.012}deg)` };

  return (
    <div
      className={`quiz-card${leaving ? ` quiz-card-leaving-${leaving}` : ""}${
        dx !== 0 ? " quiz-card-dragging" : ""
      }`}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <h1 className="quiz-prompt" ref={heading} tabIndex={-1}>
        {question.prompt}
      </h1>

      <div className="quiz-options">
        <button
          type="button"
          className={`quiz-option${leanLeft ? " quiz-option-on" : ""}`}
          onClick={() => tapOption(-1)}
        >
          {question.a}
        </button>
        <button
          type="button"
          className={`quiz-option${leanRight ? " quiz-option-on" : ""}`}
          onClick={() => tapOption(1)}
        >
          {question.b}
        </button>
      </div>

      <div className="quiz-scale" role="group" aria-label={question.prompt}>
        {SCALE.map((point) => {
          const side = point.value < 0 ? question.a : point.value > 0 ? question.b : null;
          return (
            <button
              type="button"
              key={point.value}
              className={`quiz-dot quiz-dot-${Math.abs(point.value)}${
                shown === point.value ? " quiz-dot-on" : ""
              }`}
              aria-label={side ? `${point.label}: ${side}` : "Both equally"}
              aria-pressed={value === point.value}
              onClick={() => onAnswer(point.value)}
            >
              <span className="quiz-dot-mark" />
              <span className="quiz-dot-label">{point.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h15M15 4l4 4-4 4" />
      <path d="M20 16H5M9 12l-4 4 4 4" />
    </svg>
  );
}

function ResultBar({ dimension }) {
  const { labels, side, strength, close, chosen } = dimension;
  const leansFirst = side === "first";
  const lean = labels[leansFirst ? 0 : 1];

  return (
    <div className="result-bar">
      <div className="result-bar-labels">
        <span className={leansFirst ? "result-bar-lean" : ""}>{labels[0]}</span>
        {close && <span className="result-bar-close">{chosen ? "Your call" : "Close"}</span>}
        <span className={leansFirst ? "" : "result-bar-lean"}>{labels[1]}</span>
      </div>
      <div
        className="result-bar-track"
        role="img"
        aria-label={`${lean}, ${strength} out of 100${close ? ", a close call" : ""}`}
      >
        {/* Grows out from the middle. Never quite zero, because even a dead heat
            that someone settled themselves still leans the way they chose. */}
        <span
          className={`result-bar-fill result-bar-fill-${leansFirst ? "first" : "second"}`}
          style={{ width: `${Math.max(strength, 8) / 2}%` }}
        />
      </div>
    </div>
  );
}

function Result({ result, reveal, onRetake, onContinue, continueLabel }) {
  return (
    <div className={`result${reveal ? " result-reveal" : ""}`}>
      <div className="result-head">
        <AnimalDoodle type={result.code} className="doodle-large" />
        <div className="result-name">
          <div className="result-code">{result.code}</div>
          <h1 className="result-animal">{result.animal}</h1>
        </div>
      </div>

      <div className="result-card">
        {result.careless && (
          <div className="result-warning">
            Nearly all your answers were the same, so this may not say much about you. It's worth
            another go when you have a few minutes.
          </div>
        )}
        {result.dimensions.map((dimension) => (
          <ResultBar key={dimension.key} dimension={dimension} />
        ))}
        <button type="button" className="result-retake" onClick={onRetake}>
          <SwapIcon />
          <span>
            Not quite you? <u>Swipe again</u>
          </span>
        </button>
      </div>

      <h2 className="result-title">{result.title}</h2>
      <p className="result-blurb">{result.blurb}</p>

      <button type="button" className="btn btn-primary result-continue" onClick={onContinue}>
        {continueLabel}
      </button>
    </div>
  );
}

export default function Personality() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user, personalityDue, personalityType, setPersonality } = useAuth();

  // Opened from somewhere inside the app, this returns there. As part of signing
  // up it goes on to the dashboard, where the route guard asks for a PIN next.
  const returnTo = location.state?.from || "/dashboard";

  // loading | intro | asking | saving | choosing | result | failed
  const [phase, setPhase] = useState("loading");
  const [version, setVersion] = useState(null);
  const [core, setCore] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [choices, setChoices] = useState({});
  const [dimensions, setDimensions] = useState([]);
  const [leaving, setLeaving] = useState(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [extraFrom, setExtraFrom] = useState(null);
  const [result, setResult] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");

  const userId = user?.id;
  const advancing = useRef(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!token || !userId) return undefined;

    const controller = new AbortController();
    let active = true;

    Promise.all([
      api.personalityQuiz(token, controller.signal),
      api.personalityResult(token, controller.signal),
    ])
      .then(([quiz, saved]) => {
        if (!active) return;
        setVersion(quiz.version);
        setCore(quiz.questions);

        const draft = readDraft(userId, quiz.version);
        setHasDraft(Boolean(draft));

        if (saved.result) {
          setResult(saved.result);
          setPhase("result");
        } else {
          setPhase("intro");
        }
      })
      .catch((err) => {
        if (!active || err.name === "AbortError") return;
        setError(err.message);
        setPhase("failed");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, userId]);

  function begin() {
    const draft = readDraft(userId, version);
    const list = draft?.questions?.length ? draft.questions : core;
    setQuestions(list);
    setAnswers(draft?.answers || {});
    setChoices(draft?.choices || {});
    setExtraFrom(draft?.extraFrom ?? null);
    setIndex(Math.min(draft?.index ?? 0, list.length - 1));
    setError("");
    setPhase("asking");
  }

  function startOver() {
    clearDraft(userId);
    setHasDraft(false);
    setResult(null);
    setReveal(false);
    setQuestions(core);
    setAnswers({});
    setChoices({});
    setExtraFrom(null);
    setIndex(0);
    setError("");
    setPhase("asking");
  }

  // Leaving is allowed, and the answers stay on the device. The prompt comes back
  // on the next launch, the same way the PIN's does.
  function later() {
    try {
      sessionStorage.setItem("personalityPromptSkipped", "1");
    } catch {
      /* storage unavailable; the prompt simply reappears */
    }
    navigate(returnTo, { replace: true });
  }

  const submit = useCallback(
    async (nextAnswers, nextChoices, currentQuestions) => {
      setPhase("saving");
      setError("");
      try {
        const step = await api.submitPersonality(token, {
          version,
          answers: nextAnswers,
          choices: nextChoices,
        });

        if (step.status === "more") {
          // Added to the end rather than replacing anything, so going back still
          // walks through every question that was asked.
          const known = new Set(currentQuestions.map((q) => q.id));
          const fresh = step.questions.filter((q) => !known.has(q.id));
          const list = [...currentQuestions, ...fresh];
          const start = list.findIndex((q) => nextAnswers[q.id] === undefined);
          setQuestions(list);
          setExtraFrom(currentQuestions.length);
          setIndex(start);
          setPhase("asking");
          writeDraft(userId, {
            version,
            questions: list,
            answers: nextAnswers,
            choices: nextChoices,
            index: start,
            extraFrom: currentQuestions.length,
          });
          return;
        }

        if (step.status === "choose") {
          setDimensions(step.dimensions);
          setPhase("choosing");
          return;
        }

        clearDraft(userId);
        setHasDraft(false);
        setPersonality(step.result.code);
        setResult(step.result);
        setReveal(true);
        setPhase("result");
      } catch (err) {
        setError(err.message);
        // The bank changed underneath them, so these answers mean nothing now.
        if (err.status === 409) clearDraft(userId);
        setPhase(err.status === 409 ? "failed" : "asking");
      }
    },
    [setPersonality, token, userId, version]
  );

  const answer = useCallback(
    (value) => {
      if (advancing.current) return;
      const question = questions[index];
      if (!question) return;

      advancing.current = true;
      const next = { ...answers, [question.id]: value };
      setAnswers(next);
      setLeaving(value < 0 ? "left" : value > 0 ? "right" : "up");

      const nextIndex = index + 1;
      writeDraft(userId, {
        version,
        questions,
        answers: next,
        choices,
        index: Math.min(nextIndex, questions.length - 1),
        extraFrom,
      });

      timer.current = setTimeout(() => {
        advancing.current = false;
        setLeaving(null);
        if (nextIndex < questions.length) {
          setIndex(nextIndex);
        } else {
          submit(next, choices, questions);
        }
      }, ADVANCE_MS);
    },
    [answers, choices, extraFrom, index, questions, submit, userId, version]
  );

  function goBack() {
    if (index > 0 && !advancing.current) setIndex(index - 1);
  }

  function choose(dimensionKey, pole) {
    const next = { ...choices, [dimensionKey]: pole };
    setChoices(next);
    const remaining = dimensions.filter((d) => d.key !== dimensionKey);
    setDimensions(remaining);
    if (remaining.length === 0) submit(answers, next, questions);
  }

  // Number keys for the five points, arrows for a mild answer either way. Handled
  // on the window so they work without having to focus anything first.
  useEffect(() => {
    if (phase !== "asking") return undefined;

    function handleKey(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key >= "1" && event.key <= "5") answer(SCALE[Number(event.key) - 1].value);
      else if (event.key === "ArrowLeft") answer(-1);
      else if (event.key === "ArrowRight") answer(1);
      else if (event.key === "Backspace") goBack();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  if (phase === "loading" || (phase === "saving" && !result)) {
    return (
      <div className="quiz-shell quiz-shell-center">
        <span className="spinner spinner-dark" />
        {phase === "saving" && <p className="quiz-saving">Working out your animal…</p>}
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="quiz-shell quiz-shell-center">
        <div className="error-banner">{error}</div>
        <button
          type="button"
          className="btn btn-secondary btn-inline"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === "result" && result) {
    return (
      <div className="quiz-shell">
        <Result
          result={result}
          reveal={reveal}
          onRetake={startOver}
          onContinue={() => navigate(returnTo, { replace: true })}
          continueLabel={location.state?.from ? "Done" : "Continue"}
        />
      </div>
    );
  }

  if (phase === "choosing" && dimensions[0]) {
    const dimension = dimensions[0];
    return (
      <div className="quiz-shell">
        <div className="quiz-choose">
          <div className="quiz-eyebrow">Too close to call</div>
          <h1 className="quiz-prompt">Your answers landed right between these two. Which sounds more like you?</h1>
          <div className="quiz-choose-options">
            {dimension.options.map((option) => (
              <button
                type="button"
                key={option.pole}
                className="quiz-choice"
                onClick={() => choose(dimension.key, option.pole)}
              >
                <span className="quiz-choice-label">{option.label}</span>
                <span className="quiz-choice-text">{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "intro") {
    const count = core.length;
    return (
      <div className="quiz-shell quiz-shell-center">
        <div className="quiz-intro">
          <div className="quiz-eyebrow">One thing before you start</div>
          <h1 className="quiz-intro-title">Which animal are you?</h1>
          <p>
            {count} quick questions, about 5 minutes. Each one has two sides. Go with what you
            naturally do, not what you think you should do. There are no right answers.
          </p>

          <div className="quiz-demo" aria-hidden="true">
            <span className="quiz-demo-option">Plan it</span>
            <span className="quiz-demo-dots">
              <i className="quiz-demo-dot-2" />
              <i className="quiz-demo-dot-1 quiz-demo-dot-on" />
              <i className="quiz-demo-dot-0" />
              <i className="quiz-demo-dot-1" />
              <i className="quiz-demo-dot-2" />
            </span>
            <span className="quiz-demo-option">Wing it</span>
          </div>
          <p className="quiz-intro-how">Tap the dot closest to you, or swipe the card towards your answer.</p>

          <button type="button" className="btn btn-primary" onClick={begin}>
            {hasDraft ? "Pick up where you left off" : "Start"}
          </button>
          {hasDraft && (
            <button type="button" className="btn btn-secondary quiz-intro-restart" onClick={startOver}>
              Start again
            </button>
          )}

          <p className="quiz-intro-note">
            Your result is saved to your profile, and leaders and admins can see it. It's a guide
            to how you tend to work, not a verdict on who you are.
          </p>

          <button type="button" className="link-btn quiz-later" onClick={later}>
            {personalityDue ? "Skip for now" : "Not now"}
          </button>
        </div>
      </div>
    );
  }

  const question = questions[index];
  if (!question) return null;

  const answered = questions.filter((q) => answers[q.id] !== undefined).length;
  const percent = Math.round((answered / questions.length) * 100);

  return (
    <div className="quiz-shell quiz-shell-asking">
      <div className="quiz-top">
        <button
          type="button"
          className="quiz-back"
          onClick={goBack}
          disabled={index === 0}
          aria-label="Previous question"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div
          className="quiz-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Quiz progress"
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <span className="quiz-count">
          {index + 1}/{questions.length}
        </span>
      </div>

      {error && <div className="error-banner quiz-error">{error}</div>}

      {extraFrom !== null && index >= extraFrom && (
        <div className="quiz-extra">Some of your answers were close, so here are a few more to be sure.</div>
      )}

      <QuestionCard
        key={question.id}
        question={question}
        value={answers[question.id]}
        leaving={leaving}
        onAnswer={answer}
      />

      {index === 0 && (
        <p className="quiz-hint">Tap a dot, or swipe the card towards your answer.</p>
      )}

      <div className="quiz-bottom">
        <button type="button" className="link-btn quiz-later" onClick={later}>
          Finish later
        </button>
      </div>
    </div>
  );
}
