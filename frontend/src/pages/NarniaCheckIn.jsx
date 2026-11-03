import React, { useCallback, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getDeviceAccount } from "../lib/device.js";
import { usePoll } from "../lib/usePoll.js";
import NarniaPhotos from "../components/NarniaPhotos.jsx";
import BrandMark from "../components/BrandMark.jsx";

// Where a QR code lands. The phone's own camera opens this in a browser that is
// not signed in, whatever is installed on the home screen, so an account here is
// one sign-in away rather than already there. That is what it offers first, and
// after that the device remembers them. An account already signed in is checked
// in without being asked anything. While a leader allows it, someone without an
// account can still type their name.
const POLL_MS = 5000;

// What the phone keeps so that reopening this page finds its own job. Per code,
// and in localStorage rather than with the sign-in, so closing the browser between
// tasks does not lose it.
function keyName(code) {
  return `narniaKey:${code}`;
}

function readKey(code) {
  try {
    return localStorage.getItem(keyName(code));
  } catch {
    return null;
  }
}

function writeKey(code, key) {
  try {
    localStorage.setItem(keyName(code), key);
  } catch {
    /* storage unavailable; the page still works until it is closed */
  }
}

function Frame({ children }) {
  return (
    <div className="narnia-phone">
      <div className="narnia-phone-brand">
        <BrandMark />
        Narnia BM
      </div>
      {children}
    </div>
  );
}

function TaskCard({ task, inRoom, onToggle, busy, locked }) {
  return (
    <section className={`narnia-job-task${task.done ? " narnia-job-task-done" : ""}`}>
      <h2 className="narnia-job-task-title">{task.title}</h2>
      {/* Only worth saying when it is not the room at the top of the page. */}
      {task.roomName !== inRoom && <div className="narnia-job-task-room">{task.roomName}</div>}

      {task.logistics.length > 0 && (
        <>
          <h3 className="narnia-subhead">What to use</h3>
          <ul className="narnia-logistics narnia-logistics-large">
            {task.logistics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {task.note && <p className="narnia-note">{task.note}</p>}

      {task.with.length > 0 && (
        <p className="narnia-job-with">
          <strong>Together with:</strong> {task.with.join(", ")}
        </p>
      )}

      {!locked && (
        <button
          type="button"
          className={`btn ${task.done ? "btn-secondary" : "btn-primary"} narnia-job-done`}
          onClick={() => onToggle(task)}
          disabled={busy}
        >
          {task.done ? "Done ✓ (tap to undo)" : "Mark as done"}
        </button>
      )}
      {locked && task.done && <p className="narnia-job-with">Done ✓</p>}
    </section>
  );
}

export default function NarniaCheckIn() {
  const { code: rawCode } = useParams();
  const code = rawCode.toUpperCase();
  const location = useLocation();
  const { token, user, loading: authLoading } = useAuth();

  const [state, setState] = useState(null);
  const [name, setName] = useState("");
  const [typingName, setTypingName] = useState(false);
  const [fatal, setFatal] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyTask, setBusyTask] = useState(null);

  const revision = useRef(0);
  // A signed-in check-in is attempted once per visit, so being removed from the
  // list by a leader is not undone by the next poll.
  const triedAccount = useRef(false);
  const hasShown = useRef(false);

  const adopt = useCallback(
    (data) => {
      if (data.key) writeKey(code, data.key);
      setState(data);
    },
    [code]
  );

  const load = useCallback(async () => {
    const at = revision.current;
    try {
      const data = await api.narniaJob(code, { token, key: readKey(code) });
      if (at !== revision.current) return;

      if (!data.me && token && data.session.status === "open" && !triedAccount.current) {
        triedAccount.current = true;
        // Anything still on its way predates this, and would show the name form.
        revision.current += 1;
        adopt(await api.narniaJoin(code, { token, key: readKey(code) }));
        hasShown.current = true;
        return;
      }

      setState(data);
      hasShown.current = true;
      setFatal("");
    } catch (err) {
      // A blip between polls can pass unremarked. With nothing on the screen yet,
      // or a code that is simply wrong, there is nothing else to show but this.
      if (err.status === 404 || !hasShown.current) setFatal(err.message);
    }
  }, [adopt, code, token]);

  // Waits for the sign-in to settle, so an account is not treated as a stranger.
  usePoll(load, POLL_MS, !authLoading);

  // With an account the name comes from the account, so none is sent.
  async function checkIn(event) {
    event.preventDefault();
    if (!token && !name.trim()) return;
    setSubmitting(true);
    setError("");
    revision.current += 1;
    try {
      adopt(await api.narniaJoin(code, { token, key: readKey(code), name }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(task) {
    setBusyTask(task.id);
    setError("");
    revision.current += 1;
    try {
      setState(
        await api.narniaTick(code, task.id, { token, key: readKey(code), done: !task.done })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyTask(null);
    }
  }

  if (fatal) {
    return (
      <Frame>
        <div className="narnia-job-hero">
          <h1>That didn't work</h1>
          <p>{fatal}</p>
        </div>
      </Frame>
    );
  }

  if (!state) {
    return (
      <Frame>
        <div className="narnia-phone-center">
          <span className="spinner spinner-dark" />
        </div>
      </Frame>
    );
  }

  const ended = state.session.status !== "open";

  if (!state.me) {
    if (ended) {
      return (
        <Frame>
          <div className="narnia-job-hero">
            <h1>This BM has finished</h1>
          </div>
        </Frame>
      );
    }

    const errorBanner = error && (
      <div className="error-banner" role="alert">
        {error}
      </div>
    );

    // Signed in, but not on the list: a leader took them off it, and the page
    // does not put them back by itself.
    if (token) {
      return (
        <Frame>
          <div className="narnia-job-hero">
            <h1>Welcome! 👋</h1>
          </div>
          <form className="narnia-checkin-form" onSubmit={checkIn}>
            {errorBanner}
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? <span className="spinner" /> : `Check in as ${user?.name ?? "me"}`}
            </button>
          </form>
        </Frame>
      );
    }

    // This device has signed in before, so it only takes their PIN or password.
    const remembered = getDeviceAccount();
    const firstName = remembered?.name?.split(" ")[0];
    const returnHere = { from: location.pathname };
    const canTypeName = state.session.allowNames;

    return (
      <Frame>
        <div className="narnia-job-hero">
          <h1>{firstName ? `Welcome back, ${firstName}! 👋` : "Welcome! 👋"}</h1>
        </div>

        <div className="narnia-checkin-form">
          {!typingName && errorBanner}
          <Link
            className="btn btn-primary narnia-signin-link"
            to={remembered?.hasPin ? "/unlock" : "/login"}
            state={returnHere}
          >
            {firstName ? `Check in as ${firstName}` : "Sign in to check in"}
          </Link>
          <div className="auth-switch">
            {firstName ? "Not you? " : "New here? "}
            <Link to={firstName ? "/login" : "/signup"} state={returnHere}>
              {firstName ? "Use another account" : "Create an account"}
            </Link>
          </div>
        </div>

        {canTypeName &&
          (typingName ? (
            <form className="narnia-checkin-form narnia-name-form" onSubmit={checkIn}>
              {errorBanner}
              <div className="field">
                <label htmlFor="narnia-name">Your full name</label>
                <input
                  id="narnia-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                  maxLength={80}
                  required
                />
              </div>
              <button
                className="btn btn-secondary"
                type="submit"
                disabled={submitting || !name.trim()}
              >
                {submitting ? <span className="spinner spinner-dark" /> : "Check in with my name"}
              </button>
            </form>
          ) : (
            <div className="auth-switch">
              <button type="button" className="link-btn" onClick={() => setTypingName(true)}>
                No account yet? Just type your name
              </button>
            </div>
          ))}
      </Frame>
    );
  }

  const { me, job } = state;
  const firstName = me.name.split(" ")[0];
  const myTaskIds = new Set(job.tasks.map((task) => task.id));
  const restOfRoom = job.room?.tasks.filter((task) => !myTaskIds.has(task.id)) ?? [];

  return (
    <Frame>
      {ended ? (
        <div className="narnia-job-hero">
          <h1>Thank you, {firstName}! 🙌</h1>
        </div>
      ) : job.tasks.length > 0 ? (
        <div className="narnia-job-hero">
          <h1>{job.room?.name ?? job.tasks[0].roomName}</h1>
        </div>
      ) : job.room ? (
        <div className="narnia-job-hero">
          <h1>{job.room.name}</h1>
        </div>
      ) : (
        <div className="narnia-job-hero">
          <div className="narnia-job-tick" aria-hidden="true">
            ✓
          </div>
          <h1>You're checked in, {firstName}!</h1>
        </div>
      )}

      {job.room && <NarniaPhotos photos={job.room.photos} />}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {job.tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          inRoom={ended ? null : job.room?.name}
          onToggle={toggle}
          busy={busyTask === task.id}
          locked={ended}
        />
      ))}

      {restOfRoom.length > 0 && (
        <section className="narnia-job-section">
          <h2 className="narnia-subhead">Also happening in {job.room.name}</h2>
          <ul className="narnia-rest">
            {restOfRoom.map((task) => (
              <li key={task.id} className={task.done ? "narnia-rest-done" : ""}>
                <span>{task.done ? "✓ " : ""}{task.title}</span>
                {task.people.length > 0 && <small>{task.people.join(", ")}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {token && (
        <div className="auth-switch">
          <Link to="/dashboard">Back to the app</Link>
        </div>
      )}
    </Frame>
  );
}
