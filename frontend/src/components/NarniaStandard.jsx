import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { shrinkPhoto } from "../lib/shrinkPhoto.js";
import NarniaPhotos from "./NarniaPhotos.jsx";
import TwoTapButton from "./TwoTapButton.jsx";

// Opens the camera or the photo library, whichever the phone offers, and uploads
// what comes back.
function AddPhoto({ roomId, onRooms, onError }) {
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
        const { rooms } = await api.narniaAddPhoto(token, roomId, { image });
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
        {busy ? "Adding…" : "+ Photo"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleFiles}
        aria-label="Add a photo of the room"
      />
    </>
  );
}

// The room's list: the one place an item is added or taken away.
function LogisticsEditor({ items, onChange }) {
  const [value, setValue] = useState("");

  function add(event) {
    event.preventDefault();
    if (!value.trim()) return;
    // The server splits on commas and drops repeats.
    onChange([...items, value]);
    setValue("");
  }

  return (
    <>
      <ul className="narnia-logistics">
        {items.map((item) => (
          <li className="narnia-logistic-edit" key={item}>
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(items.filter((other) => other !== item))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form className="narnia-add-person" onSubmit={add}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add logistics"
          aria-label="Add logistics"
          maxLength={200}
        />
        <button type="submit" className="btn btn-secondary btn-inline" disabled={!value.trim()}>
          Add
        </button>
      </form>
    </>
  );
}

function TaskForm({ initial, roomLogistics, submitLabel, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [picked, setPicked] = useState(initial?.logistics ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const saved = await onSubmit({ title, logistics: picked, note });
    setSaving(false);
    if (saved && !initial) {
      setTitle("");
      setPicked([]);
      setNote("");
    }
  }

  const toggle = (item) =>
    setPicked((list) =>
      list.includes(item) ? list.filter((other) => other !== item) : [...list, item]
    );

  return (
    <form className="narnia-task-form" onSubmit={handleSubmit}>
      <div className="field">
        <label>Task</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sweep the floor"
          maxLength={120}
          required
        />
      </div>
      {roomLogistics.length > 0 && (
        <div className="field">
          <label>What to use</label>
          <div className="narnia-picks">
            {roomLogistics.map((item) => (
              <button
                type="button"
                key={item}
                className={`narnia-pick${picked.includes(item) ? " narnia-pick-on" : ""}`}
                aria-pressed={picked.includes(item)}
                onClick={() => toggle(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label>Notes</label>
        <textarea
          className="narnia-textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
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

function TaskRow({ task, roomLogistics, onRooms, onError }) {
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

  if (editing) {
    return (
      <li className="narnia-task">
        <TaskForm
          initial={task}
          roomLogistics={roomLogistics}
          submitLabel="Save"
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="narnia-task">
      <div className="narnia-task-head">
        <span className="narnia-task-title">{task.title}</span>
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
      </div>
      {task.logistics.length > 0 && (
        <ul className="narnia-logistics">
          {task.logistics.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {task.note && <p className="narnia-note">{task.note}</p>}
    </li>
  );
}

function RoomCard({ room, canDelete, onRooms }) {
  const { token } = useAuth();
  const [name, setName] = useState(room.name);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <section className="panel narnia-room">
      <input
        className="narnia-room-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        aria-label="Room name"
        maxLength={120}
      />

      {error && <div className="error-banner panel-notice">{error}</div>}

      <NarniaPhotos
        photos={room.photos}
        onRemove={(photo) => run(() => api.narniaDeletePhoto(token, photo.id))}
      />
      <div className="narnia-add-row">
        <AddPhoto roomId={room.id} onRooms={onRooms} onError={setError} />
      </div>

      <h3 className="narnia-subhead">Logistics</h3>
      <LogisticsEditor
        items={room.logistics}
        onChange={(logistics) => run(() => api.narniaUpdateRoom(token, room.id, { logistics }))}
      />

      <h3 className="narnia-subhead">What to do</h3>
      <ul className="narnia-task-list">
        {room.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            roomLogistics={room.logistics}
            onRooms={onRooms}
            onError={setError}
          />
        ))}
      </ul>

      {adding ? (
        <TaskForm
          roomLogistics={room.logistics}
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
      )}

      {canDelete && (
        <div className="narnia-add-row">
          <TwoTapButton
            className="link-btn link-btn-danger"
            confirmLabel="Tap again to delete"
            onConfirm={() => run(() => api.narniaDeleteRoom(token, room.id))}
          >
            Delete room
          </TwoTapButton>
        </div>
      )}
    </section>
  );
}

// Editing every room. What members read is pages/Narnia.jsx.
export default function NarniaStandard({ rooms, onRooms }) {
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
          <RoomCard key={room.id} room={room} canDelete={rooms.length > 1} onRooms={onRooms} />
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      <button type="button" className="btn btn-secondary btn-inline narnia-add-room" onClick={addRoom}>
        + Room
      </button>
    </>
  );
}
