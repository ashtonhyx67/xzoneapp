import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { roomLogistics } from "../lib/narnia.js";
import { shrinkPhoto } from "../lib/shrinkPhoto.js";
import NarniaPhotos from "./NarniaPhotos.jsx";
import TwoTapButton from "./TwoTapButton.jsx";

// Opens the camera or the photo library, whichever the phone offers, and uploads
// what comes back.
function AddPhoto({ roomId, taskId = null, onRooms, onError, label = "+ Photo" }) {
  const { token } = useAuth();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(event) {
    const files = [...event.target.files];
    event.target.value = "";
    if (files.length === 0) return;

    setBusy(true);
    onError("");
    try {
      // One at a time, so a bad file in the middle does not lose the ones before it.
      for (const file of files) {
        const image = await shrinkPhoto(file);
        const { rooms } = await api.narniaAddPhoto(token, roomId, { image, taskId });
        onRooms(rooms);
      }
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-inline"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        {busy ? "Adding…" : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleFiles}
        aria-label="Add a photo of the standard"
      />
    </>
  );
}

function TaskForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [logistics, setLogistics] = useState((initial?.logistics ?? []).join(", "));
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const saved = await onSubmit({ title, logistics, note });
    setSaving(false);
    if (saved && !initial) {
      setTitle("");
      setLogistics("");
      setNote("");
    }
  }

  return (
    <form className="narnia-task-form" onSubmit={handleSubmit}>
      <div className="field">
        <label>What needs doing</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sweep the floor"
          maxLength={120}
          required
        />
      </div>
      <div className="field">
        <label>What to use (separate with commas)</label>
        <input
          value={logistics}
          onChange={(e) => setLogistics(e.target.value)}
          placeholder="Broom, Dustpan"
        />
      </div>
      <div className="field">
        <label>Any notes (optional)</label>
        <textarea
          className="narnia-textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Start from the corner by the door"
        />
      </div>
      <div className="narnia-form-actions">
        <button className="btn btn-primary btn-inline" type="submit" disabled={saving}>
          {submitLabel}
        </button>
        {onCancel && (
          <button className="btn btn-secondary btn-inline" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Logistics({ items }) {
  if (items.length === 0) return null;
  return (
    <ul className="narnia-logistics">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function TaskRow({ task, roomId, canRun, onRooms, onError, removePhoto }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);

  async function save(fields) {
    onError("");
    try {
      const { rooms } = await api.narniaUpdateTask(token, task.id, fields);
      onRooms(rooms);
      setEditing(false);
      return true;
    } catch (err) {
      onError(err.message);
      return false;
    }
  }

  async function remove() {
    onError("");
    try {
      const { rooms } = await api.narniaDeleteTask(token, task.id);
      onRooms(rooms);
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <li className="narnia-task">
      {editing ? (
        <TaskForm
          initial={task}
          submitLabel="Save"
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="narnia-task-head">
            <span className="narnia-task-title">{task.title}</span>
            {canRun && (
              <span className="narnia-task-tools">
                <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <TwoTapButton
                  className="link-btn link-btn-danger"
                  confirmLabel="Tap again"
                  onConfirm={remove}
                >
                  Delete
                </TwoTapButton>
              </span>
            )}
          </div>
          <Logistics items={task.logistics} />
          {task.note && <p className="narnia-note">{task.note}</p>}
          <NarniaPhotos photos={task.photos} onRemove={canRun ? removePhoto : undefined} />
          {canRun && (
            <div className="narnia-task-photo-add">
              <AddPhoto
                roomId={roomId}
                taskId={task.id}
                onRooms={onRooms}
                onError={onError}
                label="+ Photo of this done well"
              />
            </div>
          )}
        </>
      )}
    </li>
  );
}

function RoomCard({ room, canRun, canDelete, onRooms }) {
  const { token } = useAuth();
  const [name, setName] = useState(room.name);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const needed = roomLogistics(room);

  async function run(call) {
    setError("");
    try {
      const { rooms } = await call();
      onRooms(rooms);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  function saveName() {
    const next = name.trim();
    if (!next) setName(room.name);
    else if (next !== room.name) run(() => api.narniaUpdateRoom(token, room.id, { name: next }));
  }

  const removePhoto = (photo) => run(() => api.narniaDeletePhoto(token, photo.id));

  return (
    <section className="panel narnia-room">
      <div className="narnia-room-head">
        {canRun ? (
          <input
            className="narnia-room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
            aria-label="Room name"
            maxLength={120}
          />
        ) : (
          <h2 className="narnia-room-name-text">{room.name}</h2>
        )}
        {canRun && canDelete && (
          <TwoTapButton
            className="link-btn link-btn-danger"
            confirmLabel="Tap again to delete"
            onConfirm={() => run(() => api.narniaDeleteRoom(token, room.id))}
          >
            Delete room
          </TwoTapButton>
        )}
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}

      <h3 className="narnia-subhead">The excellent standard</h3>
      {room.photos.length === 0 && (
        <p className="narnia-empty">
          {canRun ? "Add photos of this room when it's done well." : "No photos yet."}
        </p>
      )}
      <NarniaPhotos photos={room.photos} onRemove={canRun ? removePhoto : undefined} />
      {canRun && (
        <div className="narnia-add-row">
          <AddPhoto roomId={room.id} onRooms={onRooms} onError={setError} />
        </div>
      )}

      {needed.length > 0 && (
        <>
          <h3 className="narnia-subhead">Logistics to gather</h3>
          <Logistics items={needed} />
        </>
      )}

      <h3 className="narnia-subhead">What to do</h3>
      {room.tasks.length === 0 && <p className="narnia-empty">No tasks yet.</p>}
      <ul className="narnia-task-list">
        {room.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            roomId={room.id}
            canRun={canRun}
            onRooms={onRooms}
            onError={setError}
            removePhoto={removePhoto}
          />
        ))}
      </ul>

      {canRun &&
        (adding ? (
          <TaskForm
            submitLabel="Add task"
            onSubmit={(fields) => run(() => api.narniaAddTask(token, room.id, fields))}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <div className="narnia-add-row">
            <button
              type="button"
              className="btn btn-secondary btn-inline"
              onClick={() => setAdding(true)}
            >
              + Task
            </button>
          </div>
        ))}
    </section>
  );
}

// The standard itself: the same page for everyone, and editable by whoever runs BM.
export default function NarniaStandard({ rooms, canRun, onRooms }) {
  const { token } = useAuth();
  const [error, setError] = useState("");

  async function addRoom() {
    setError("");
    try {
      const { rooms: next } = await api.narniaAddRoom(token, {
        name: `Room ${rooms.length + 1}`,
      });
      onRooms(next);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="narnia-rooms">
        {rooms.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            canRun={canRun}
            canDelete={rooms.length > 1}
            onRooms={onRooms}
          />
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {canRun && (
        <button type="button" className="btn btn-secondary btn-inline narnia-add-room" onClick={addRoom}>
          + Room
        </button>
      )}
    </>
  );
}
