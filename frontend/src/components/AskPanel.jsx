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
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          className="ask-input"
          value={question}
          placeholder="Ask about anyone, or about a team…"
          aria-label="Ask about the records"
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn btn-primary ask-btn" type="submit" disabled={asking}>
          {asking ? "Reading…" : "Ask"}
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
