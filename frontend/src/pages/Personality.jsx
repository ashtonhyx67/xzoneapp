import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import AnimalDoodle from "../components/AnimalDoodle.jsx";

// Long enough to see the answer land before the next card replaces it.
const ADVANCE_MS = 170;

// -1 is the first option and +1 the second. The server knows which pole each
// side belongs to; this page does not.
const FIRST = -1;
const SECOND = 1;

// Answers are kept as they are given, so stepping away loses nothing. Keyed by
// account, since a device can be shared.
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

function QuestionCard({ question, value, leaving, onAnswer }) {
  const heading = useRef(null);

  // Each card replaces the last, so without this a screen reader is left on
  // nothing after every answer.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={`quiz-card${leaving ? " quiz-card-leaving" : ""}`}>
      <h1 className="quiz-prompt" ref={heading} tabIndex={-1}>
        {question.prompt}
      </h1>

      <div className="quiz-options">
        <button
          type="button"
          className={`quiz-option${value === FIRST ? " quiz-option-on" : ""}`}
          aria-pressed={value === FIRST}
          onClick={() => onAnswer(FIRST)}
        >
          {question.a}
        </button>
        <button
          type="button"
          className={`quiz-option${value === SECOND ? " quiz-option-on" : ""}`}
          aria-pressed={value === SECOND}
          onClick={() => onAnswer(SECOND)}
        >
          {question.b}
        </button>
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
        {result.dimensions.map((dimension) => (
          <ResultBar key={dimension.key} dimension={dimension} />
        ))}
        <button type="button" className="result-retake" onClick={onRetake}>
          <SwapIcon />
          <span>Take it again</span>
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
  const { token, user, personalityDue, setPersonality } = useAuth();

  // Opened from somewhere inside the app, this returns there. As part of signing
  // up it goes on to the dashboard, where the route guard asks for a PIN next.
  const returnTo = location.state?.from || "/dashboard";

  // loading | intro | asking | saving | result | failed
  const [phase, setPhase] = useState("loading");
  const [version, setVersion] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [leaving, setLeaving] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
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
        setQuestions(quiz.questions);

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
    setAnswers(draft?.answers || {});
    setIndex(Math.min(draft?.index ?? 0, questions.length - 1));
    setError("");
    setPhase("asking");
  }

  function startOver() {
    clearDraft(userId);
    setHasDraft(false);
    setResult(null);
    setReveal(false);
    setAnswers({});
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
    async (nextAnswers) => {
      setPhase("saving");
      setError("");
      try {
        const step = await api.submitPersonality(token, { version, answers: nextAnswers });
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
      setLeaving(true);

      const nextIndex = index + 1;
      writeDraft(userId, {
        version,
        answers: next,
        index: Math.min(nextIndex, questions.length - 1),
      });

      timer.current = setTimeout(() => {
        advancing.current = false;
        setLeaving(false);
        if (nextIndex < questions.length) {
          setIndex(nextIndex);
        } else {
          submit(next);
        }
      }, ADVANCE_MS);
    },
    [answers, index, questions, submit, userId, version]
  );

  function goBack() {
    if (index > 0 && !advancing.current) setIndex(index - 1);
  }

  // 1 and 2 for the two options, Backspace to step back. Handled on the window so
  // they work without having to focus anything first.
  useEffect(() => {
    if (phase !== "asking") return undefined;

    function handleKey(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "1") answer(FIRST);
      else if (event.key === "2") answer(SECOND);
      else if (event.key === "Backspace") goBack();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  if (phase === "loading" || phase === "saving") {
    return (
      <div className="quiz-shell quiz-shell-center">
        <span className="spinner spinner-dark" />
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

  if (phase === "intro") {
    return (
      <div className="quiz-shell quiz-shell-center">
        <div className="quiz-intro">
          <h1 className="quiz-intro-title">Which animal are you?</h1>
          <button type="button" className="btn btn-primary" onClick={begin}>
            {hasDraft ? "Pick up where you left off" : "Start"}
          </button>
          {hasDraft && (
            <button type="button" className="btn btn-secondary quiz-intro-restart" onClick={startOver}>
              Start again
            </button>
          )}

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

      <QuestionCard
        key={question.id}
        question={question}
        value={answers[question.id]}
        leaving={leaving}
        onAnswer={answer}
      />

      <div className="quiz-bottom">
        <button type="button" className="link-btn quiz-later" onClick={later}>
          Finish later
        </button>
      </div>
    </div>
  );
}
