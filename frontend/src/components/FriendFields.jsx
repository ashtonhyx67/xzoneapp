import React, { useRef, useState } from "react";
import { initials } from "../lib/photo.js";
import { shrinkPhoto } from "../lib/shrinkPhoto.js";

// A picture of one person's face needs far less than a picture of a whole room.
const PHOTO_EDGE = 800;

// Suggestions rather than a fixed list: someone can always type what fits.
const STAGES = ["Secondary School", "JC", "Poly", "ITE", "NS", "University", "Working"];

let counter = 0;

export function blankFriend() {
  counter += 1;
  return {
    key: `new-${counter}`,
    id: null,
    name: "",
    photoUrl: "",
    image: null,
    removePhoto: false,
    age: "",
    birthday: "",
    stage: "",
    school: "",
    contact: "",
    telegram: "",
    instagram: "",
    religion: "",
    notes: "",
    personId: null,
  };
}

export function friendFromSaved(friend) {
  return {
    ...blankFriend(),
    ...friend,
    key: `saved-${friend.id}`,
    age: friend.age ?? "",
    birthday: friend.birthday ?? "",
    photoUrl: friend.photoUrl ?? "",
  };
}

const TEXT_FIELDS = [
  ["school", "School"],
  ["contact", "Contact"],
  ["telegram", "Telegram"],
  ["instagram", "Instagram"],
  ["religion", "Religion"],
];

export default function FriendFields({ friend, onChange, onRemove }) {
  const input = useRef(null);
  const [error, setError] = useState("");

  const set = (field) => (event) => onChange({ [field]: event.target.value });

  async function pickPhoto(event) {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const image = await shrinkPhoto(file, PHOTO_EDGE);
      onChange({ image, photoUrl: image, removePhoto: false });
    } catch (err) {
      setError(err.message);
    }
  }

  // Once a leader has added someone to the database, that record is theirs to keep
  // up to date. This one is only here to say so, and is sent back unchanged.
  if (friend.personId) {
    return (
      <div className="outing-friend outing-friend-locked">
        <span className="friend-name">{friend.name}</span>
        <span className="pool-team">In database</span>
      </div>
    );
  }

  return (
    <div className="outing-friend">
      <div className="outing-friend-photo">
        {friend.photoUrl ? (
          <img className="friend-photo" src={friend.photoUrl} alt="" />
        ) : (
          <span className="friend-photo friend-photo-empty" aria-hidden="true">
            {initials(friend.name)}
          </span>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-inline"
          onClick={() => input.current?.click()}
        >
          {friend.photoUrl ? "Change picture" : "+ Picture"}
        </button>
        {friend.photoUrl && (
          <button
            type="button"
            className="link-btn link-btn-danger"
            onClick={() => onChange({ image: null, photoUrl: "", removePhoto: true })}
          >
            Remove
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          data-field="photo"
          onChange={pickPhoto}
          aria-label="Picture"
        />
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="field">
        <label>Name</label>
        <input data-field="name" value={friend.name} onChange={set("name")} maxLength={80} />
      </div>

      <div className="outing-friends">
        <div className="field">
          <label>Age</label>
          <input
            data-field="age"
            type="number"
            inputMode="numeric"
            min="0"
            max="120"
            value={friend.age}
            onChange={set("age")}
          />
        </div>
        <div className="field">
          <label>Birthday</label>
          <input data-field="birthday" type="date" value={friend.birthday} onChange={set("birthday")} />
        </div>
      </div>

      <div className="field">
        <label>Stage of life</label>
        <input
          data-field="stage"
          list="stages-of-life"
          value={friend.stage}
          onChange={set("stage")}
          maxLength={80}
        />
        <datalist id="stages-of-life">
          {STAGES.map((stage) => (
            <option key={stage} value={stage} />
          ))}
        </datalist>
      </div>

      {TEXT_FIELDS.map(([field, label]) => (
        <div className="field" key={field}>
          <label>{label}</label>
          <input data-field={field} value={friend[field]} onChange={set(field)} maxLength={200} />
        </div>
      ))}

      <div className="field">
        <label>Notes</label>
        <textarea
          data-field="notes"
          className="outing-textarea"
          rows={2}
          value={friend.notes}
          onChange={set("notes")}
          maxLength={2000}
        />
      </div>

      <button type="button" className="link-btn link-btn-danger" onClick={onRemove}>
        Remove friend
      </button>
    </div>
  );
}
