import React, { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const SUGGESTIONS = [
  "Who hasn't come in the last month?",
  "How has attendance been trending?",
  "Who still needs following up?",
];

// Asking about what is in the app. Not a trained model — the records are read
// at the moment the question is asked, so someone added this morning can be
// asked about this afternoon, and nothing has to be retrained when a record
// changes.
export default function AskPanel() {
  const { token } = useAuth();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  async function ask(text) {
    const asked = (text ?? question).trim();
    if (!asked || asking) return;

    setQuestion(asked);
    setAsking(true);
    setError("");
    setAnswer(null);
    try {
      setAnswer(await api.ask(token, asked));
    } catch (err) {
      setError(err.message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="panel ask-panel">
      {/* One box, the way a search field is one box: the button sits inside
          the field rather than beside it, so it reads as somewhere to type
          rather than a form to fill in. */}
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <svg className="ask-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <line
            x1="10.4"
            y1="10.4"
            x2="14"
            y2="14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>

        <input
          className="ask-input"
          value={question}
          placeholder="Ask me anything"
          aria-label="Ask me anything about the records"
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
        />

        <button
          className="ask-send"
          type="submit"
          disabled={asking || !question.trim()}
        >
          {asking ? "Reading…" : "Send"}
        </button>
      </form>

      {/* Somewhere to start, for anyone who does not know what it can answer. */}
      {!answer && !asking && !error && (
        <div className="ask-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              type="button"
              className="ask-suggestion"
              key={suggestion}
              onClick={() => ask(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-banner panel-notice">{error}</div>}

      {answer && (
        <div className="ask-answer">
          <p className="ask-answer-text">{answer.answer}</p>

          {/* What it read, so an answer can be checked rather than taken on
              trust. */}
          {answer.readAbout?.length > 0 && (
            <p className="ask-source">
              Read the records of {answer.readAbout.join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
