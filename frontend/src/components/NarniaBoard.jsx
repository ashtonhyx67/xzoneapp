import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  assignToTask,
  localDay,
  roomOfTask,
  sendToRoom,
  setTaskDone,
  takeOffTask,
} from "../lib/narnia.js";
import { useDragAndDrop } from "../lib/useDragAndDrop.js";
import { usePoll } from "../lib/usePoll.js";
import QrCode from "./QrCode.jsx";
import TwoTapButton from "./TwoTapButton.jsx";
import { SkeletonRows } from "./Skeleton.jsx";

// Often enough that someone who has just scanned appears before the leader looks
// back down at the screen.
const POLL_MS = 3000;

const sameTarget = (a, b) => a === b || (a?.type === b?.type && a?.id === b?.id);

// What a dragged name is over, whichever it is: a task, a room, or the list of
// people still to place.
function findTarget(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const task = el.closest("[data-drop-task]");
  if (task) return { type: "task", id: Number(task.dataset.dropTask) };
  const room = el.closest("[data-drop-room]");
  if (room) return { type: "room", id: Number(room.dataset.dropRoom) };
  return el.closest("[data-drop-pool]") ? { type: "pool" } : null;
}

// Fills the screen so it can be held up, or put on the projector, and read from
// across a room.
function FullScreenQr({ url, code, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="narnia-qr-full" role="dialog" aria-modal="true" onClick={onClose}>
      <h2>Scan to check in</h2>
      <QrCode value={url} label="QR code to check in to Narnia BM" className="narnia-qr-big" />
      <p className="narnia-code-text">{code}</p>
      <button type="button" className="btn btn-secondary btn-inline" ref={closeRef}>
        Close
      </button>
    </div>,
    document.body
  );
}

function CheckInCard({ session, count, onAllowNames }) {
  const [big, setBig] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/narnia/in/${session.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* no clipboard here; the code is on the screen to read out */
    }
  }

  return (
    <section className="panel narnia-checkin">
      <button
        type="button"
        className="narnia-qr-small"
        onClick={() => setBig(true)}
        aria-label="Show the QR code full screen"
      >
        <QrCode value={url} label="QR code to check in to Narnia BM" />
      </button>
      <div className="narnia-checkin-body">
        <div className="narnia-count">
          <span className="narnia-count-number">{count}</span> checked in
        </div>
        <div className="narnia-form-actions">
          <button type="button" className="btn btn-primary btn-inline" onClick={() => setBig(true)}>
            Show QR big
          </button>
          <button type="button" className="btn btn-secondary btn-inline" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {/* Turned off once everyone is onboarded, and stays off for the next BM. */}
        <label className="narnia-toggle">
          <input
            type="checkbox"
            checked={session.allowNames}
            onChange={(e) => onAllowNames(e.target.checked)}
          />
          <span>Let people without an account check in with their name</span>
        </label>
      </div>
      {big && <FullScreenQr url={url} code={session.code} onClose={() => setBig(false)} />}
    </section>
  );
}

function Chip({ person, held, lifted, dnd, item, onPick, onClear, clearLabel }) {
  return (
    <span
      className={`narnia-chip${held ? " narnia-chip-held" : ""}${lifted ? " narnia-chip-lifted" : ""}`}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => dnd.pointerDown(e, item, item.key)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (!dnd.justDragged()) onPick(item);
      }}
      onKeyDown={(e) => {
        if ((e.key !== "Enter" && e.key !== " ") || e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        onPick(item);
      }}
    >
      <span className="narnia-chip-name">{person.name}</span>
      {person.byHand && (
        <span className="narnia-chip-flag" title="Added by hand">
          ✎
        </span>
      )}
      {onClear && (
        <button
          type="button"
          className="narnia-chip-clear"
          aria-label={clearLabel}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

// Where a leader runs the morning: the QR code, the people as they arrive, and the
// rooms to send them to. Tap a name then a task, or drag it, the way Seating works.
export default function NarniaBoard() {
  const { token } = useAuth();
  // undefined until the first answer; null means nothing is running.
  const [session, setSession] = useState(undefined);
  const [held, setHeld] = useState(null);
  const [newName, setNewName] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // Bumped by every change. An answer to a request sent before the latest change
  // knows nothing about it, and must not put the screen back the way it was.
  const revision = useRef(0);
  const hasLoaded = useRef(false);

  const load = useCallback(async () => {
    const at = revision.current;
    try {
      const data = await api.narniaCurrent(token);
      hasLoaded.current = true;
      if (at === revision.current) setSession(data.session);
    } catch (err) {
      // A blip between polls can pass unremarked; the next one will put it right.
      if (!hasLoaded.current) setError(err.message);
    }
  }, [token]);

  usePoll(load, POLL_MS);

  async function change(call, optimistic) {
    revision.current += 1;
    const at = revision.current;
    setError("");
    if (optimistic) setSession((current) => (current ? optimistic(current) : current));
    try {
      const data = await call();
      if (at === revision.current) setSession(data.session);
    } catch (err) {
      setError(err.message);
      revision.current += 1;
      load();
    }
  }

  async function start() {
    setStarting(true);
    await change(() => api.narniaStart(token, { heldOn: localDay() }));
    setStarting(false);
  }

  // Sends a person to wherever they were dropped or tapped.
  function place(item, target) {
    setHeld(null);
    if (!target || !session) return;
    const { checkinId, fromTaskId } = item;
    const id = session.id;

    if (target.type === "task") {
      if (fromTaskId === target.id) return;
      change(
        () => api.narniaAssign(token, id, { checkinId, taskId: target.id, fromTaskId }),
        (board) => assignToTask(board, checkinId, target.id, fromTaskId)
      );
    } else if (target.type === "room" && fromTaskId && roomOfTask(session, fromTaskId) === target.id) {
      // Off the task, and still in the room it was in.
      change(
        () => api.narniaUnassign(token, id, { checkinId, taskId: fromTaskId }),
        (board) => takeOffTask(board, checkinId, fromTaskId)
      );
    } else {
      const roomId = target.type === "room" ? target.id : null;
      change(
        () => api.narniaSendToRoom(token, id, { checkinId, roomId }),
        (board) => sendToRoom(board, checkinId, roomId)
      );
    }
  }

  const dnd = useDragAndDrop({
    findTarget,
    sameTarget,
    onDrop: (item, target) => place(item, target),
  });
  const { drag } = dnd;

  const pick = (item) => setHeld((current) => (current?.key === item.key ? null : item));

  // While someone is in hand, a tap on a task, a room or the list puts them there.
  const dropZone = (target) =>
    held
      ? {
          onClick: () => {
            if (!dnd.justDragged()) place(held, target);
          },
        }
      : {};

  const isOver = (type, id) => drag?.target?.type === type && drag.target.id === id;

  if (session === undefined) {
    return error ? (
      <div className="error-banner">{error}</div>
    ) : (
      <SkeletonRows count={5} label="Loading Narnia BM" />
    );
  }

  if (session === null) {
    return (
      <section className="panel narnia-start">
        {error && <div className="error-banner">{error}</div>}
        <button
          type="button"
          className="btn btn-primary btn-inline"
          onClick={start}
          disabled={starting}
        >
          {starting ? "Starting…" : "Start check-in"}
        </button>
      </section>
    );
  }

  const tasks = session.rooms.flatMap((room) => room.tasks);
  const toPlace = session.people.filter((p) => p.roomId === null && p.taskIds.length === 0);
  const placedNowhereElse = (roomId) =>
    session.people.filter((p) => p.roomId === roomId && p.taskIds.length === 0);
  const emptyTasks = tasks.filter((task) => !task.done && !session.people.some((p) => p.taskIds.includes(task.id))).length;
  const canShareOut = session.people.length > 0 && (emptyTasks > 0 || session.people.some((p) => p.taskIds.length === 0));

  function addByHand(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    change(() => api.narniaAddCheckin(token, session.id, { name }));
  }

  return (
    <div className="narnia-board">
      <CheckInCard
        session={session}
        count={session.people.length}
        onAllowNames={(allowNames) =>
          change(
            () => api.narniaAllowNames(token, session.id, allowNames),
            (board) => ({ ...board, allowNames })
          )
        }
      />

      {error && <div className="error-banner">{error}</div>}

      <section
        className={`panel narnia-pool${isOver("pool") ? " narnia-target-over" : ""}${
          held ? " narnia-target-armed" : ""
        }`}
        data-drop-pool=""
        {...dropZone({ type: "pool" })}
      >
        <div className="section-head">
          <h2 className="section-title">To place</h2>
          <span className="section-count">{toPlace.length}</span>
          <button
            type="button"
            className="btn btn-secondary btn-inline narnia-share"
            onClick={(e) => {
              e.stopPropagation();
              setHeld(null);
              change(() => api.narniaShareOut(token, session.id));
            }}
            disabled={!canShareOut}
          >
            Share out evenly
          </button>
        </div>

        {toPlace.length > 0 && (
          <div className="narnia-chips">
            {toPlace.map((person) => {
              const key = `p-${person.id}`;
              return (
                <Chip
                  key={key}
                  person={person}
                  item={{ key, checkinId: person.id, name: person.name, fromTaskId: null }}
                  held={held?.key === key}
                  lifted={drag?.key === key}
                  dnd={dnd}
                  onPick={pick}
                />
              );
            })}
          </div>
        )}

        <form
          className="narnia-add-person"
          onSubmit={addByHand}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add someone without a phone"
            aria-label="Name to add"
            maxLength={80}
          />
          <button type="submit" className="btn btn-secondary btn-inline" disabled={!newName.trim()}>
            Add
          </button>
        </form>
      </section>

      <div className="narnia-rooms">
        {session.rooms.map((room) => {
          const waiting = placedNowhereElse(room.id);
          const inRoom = session.people.filter((p) => p.roomId === room.id).length;
          const done = room.tasks.filter((task) => task.done).length;

          return (
            <section
              key={room.id}
              className={`panel narnia-room${isOver("room", room.id) ? " narnia-target-over" : ""}`}
              data-drop-room={room.id}
            >
              <div
                className={`narnia-board-room-head${held ? " narnia-target-armed" : ""}`}
                {...dropZone({ type: "room", id: room.id })}
              >
                <h2 className="narnia-room-name-text">{room.name}</h2>
                <span className="narnia-room-stats">
                  {inRoom} {inRoom === 1 ? "person" : "people"} · {done}/{room.tasks.length} done
                </span>
              </div>

              {waiting.length > 0 && (
                <div className="narnia-waiting">
                  <span className="narnia-waiting-label">Waiting for a task</span>
                  <div className="narnia-chips">
                    {waiting.map((person) => {
                      const key = `r-${person.id}`;
                      return (
                        <Chip
                          key={key}
                          person={person}
                          item={{ key, checkinId: person.id, name: person.name, fromTaskId: null }}
                          held={held?.key === key}
                          lifted={drag?.key === key}
                          dnd={dnd}
                          onPick={pick}
                          clearLabel={`Take ${person.name} out of ${room.name}`}
                          onClear={() =>
                            change(
                              () => api.narniaSendToRoom(token, session.id, { checkinId: person.id, roomId: null }),
                              (board) => sendToRoom(board, person.id, null)
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              <ul className="narnia-board-tasks">
                {room.tasks.map((task) => {
                  const onTask = session.people.filter((p) => p.taskIds.includes(task.id));
                  return (
                    <li
                      key={task.id}
                      className={`narnia-board-task${task.done ? " narnia-board-task-done" : ""}${
                        isOver("task", task.id) ? " narnia-target-over" : ""
                      }${held ? " narnia-target-armed" : ""}`}
                      data-drop-task={task.id}
                      {...dropZone({ type: "task", id: task.id })}
                    >
                      <button
                        type="button"
                        className={`narnia-tick${task.done ? " narnia-tick-on" : ""}`}
                        aria-pressed={task.done}
                        aria-label={`${task.title}: ${task.done ? "mark not done" : "mark done"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          change(
                            () => api.narniaSetDone(token, session.id, { taskId: task.id, done: !task.done }),
                            (board) => setTaskDone(board, task.id, !task.done)
                          );
                        }}
                      >
                        {task.done ? "✓" : ""}
                      </button>
                      <div className="narnia-board-task-body">
                        <div className="narnia-board-task-title">{task.title}</div>
                        {onTask.length > 0 && (
                          <div className="narnia-chips">
                            {onTask.map((person) => {
                              const key = `t-${task.id}-${person.id}`;
                              return (
                                <Chip
                                  key={key}
                                  person={person}
                                  item={{
                                    key,
                                    checkinId: person.id,
                                    name: person.name,
                                    fromTaskId: task.id,
                                  }}
                                  held={held?.key === key}
                                  lifted={drag?.key === key}
                                  dnd={dnd}
                                  onPick={pick}
                                  clearLabel={`Take ${person.name} off ${task.title}`}
                                  onClear={() =>
                                    change(
                                      () => api.narniaUnassign(token, session.id, { checkinId: person.id, taskId: task.id }),
                                      (board) => takeOffTask(board, person.id, task.id)
                                    )
                                  }
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Closed by default: the people here are what the morning is about, and
          this is a list to glance at when wondering who to call. */}
      {session.notHere.length > 0 && (
        <details className="panel narnia-not-here">
          <summary>
            <span className="narnia-history-day">Not here yet</span>
            <span className="section-count">{session.notHere.length}</span>
          </summary>
          <p className="narnia-history-names">{session.notHere.join(", ")}</p>
        </details>
      )}

      <div className="narnia-board-foot">
        <TwoTapButton
          className="btn btn-secondary btn-inline"
          confirmLabel="Tap again to end"
          onConfirm={() => {
            setHeld(null);
            change(() => api.narniaEnd(token, session.id));
          }}
        >
          End this BM
        </TwoTapButton>
      </div>

      {/* Only while someone is in hand from a tap: says the tap landed, and what
          happens next. The same bar Seating uses. */}
      {held && !drag && (
        <div className="carrying" role="status">
          <span className="carrying-name">{held.name}</span>
          <span className="carrying-hint">tap a task or room</span>
          {!held.fromTaskId && (
            <TwoTapButton
              className="carrying-cancel"
              confirmLabel="Sure?"
              onConfirm={() => {
                const { checkinId } = held;
                setHeld(null);
                change(() => api.narniaRemoveCheckin(token, session.id, checkinId));
              }}
            >
              Remove
            </TwoTapButton>
          )}
          <button className="carrying-cancel" onClick={() => setHeld(null)}>
            Cancel
          </button>
        </div>
      )}

      {drag &&
        createPortal(
          <div
            className="drag-ghost"
            ref={dnd.ghostRef}
            style={{ width: drag.rect.width, height: drag.rect.height }}
            aria-hidden="true"
          >
            <div className="drag-ghost-card">{drag.item.name}</div>
          </div>,
          document.body
        )}
    </div>
  );
}
