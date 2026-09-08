import React, { useState } from "react";
import { photoSrc, initials } from "../lib/photo.js";

// Left panel: photo. Right: two field tables, then the three long-text rows —
// the layout of the scorecard tab in the source spreadsheet.
const PERSONAL = [
  ["contact", "Contact"],
  ["telegram", "Telegram"],
  ["instagram", "Instagram"],
  ["age", "Age"],
  ["school", "School"],
  ["birthday", "Birthday"],
];

const GENERAL = [
  ["role", "Status"],
  ["team", "Team"],
  ["ministry", "Ministry"],
  ["follow_up", "Followup"],
  ["came_church", "Came Church"],
  ["invited_by", "Invited By"],
];

const NOTES = [
  ["general_information", "General Information"],
  ["updates", "Updates"],
  ["next_steps", "Next Steps"],
];

// Age is computed by the server and birthday is a plain YYYY-MM-DD string.
const READ_ONLY = new Set(["age"]);

function formatBirthday(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

function display(person, field) {
  if (field === "birthday") return formatBirthday(person.birthday);
  const value = person[field];
  return value === null || value === undefined ? "" : String(value);
}

function Photo({ person }) {
  const [failed, setFailed] = useState(false);
  const src = photoSrc(person.photo_url);

  if (!src || failed) {
    return (
      <div className="person-photo person-photo-empty">
        <span>{initials(person.name) || "?"}</span>
      </div>
    );
  }

  return (
    <div className="person-photo">
      <img src={src} alt={person.name} onError={() => setFailed(true)} loading="lazy" />
    </div>
  );
}

function FieldTable({ title, fields, person, editing, onChange }) {
  return (
    <div className="card-table">
      <div className="card-table-title">{title}</div>
      {fields.map(([field, label]) => (
        <div className="card-field" key={field}>
          <div className="card-field-label">{label}</div>
          <div className="card-field-value">
            {editing && !READ_ONLY.has(field) ? (
              <input
                aria-label={label}
                value={person[field] ?? ""}
                placeholder={field === "birthday" ? "YYYY-MM-DD" : ""}
                onChange={(e) => onChange(field, e.target.value)}
              />
            ) : (
              display(person, field) || <span className="card-empty">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PersonCard({
  person,
  people,
  onSelect,
  editing,
  onChange,
  canEdit,
  onEdit,
  onCancel,
  onSave,
  saving,
}) {
  if (!person) return null;

  return (
    <div className="person-card">
      <div className="person-side">
        <Photo person={person} />

        <select
          className="person-picker"
          value={person.id}
          onChange={(e) => onSelect(Number(e.target.value))}
          disabled={editing}
          aria-label="Select a person"
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {canEdit && (
          <div className="person-side-actions">
            {editing ? (
              <>
                <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={onSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button className="btn btn-secondary" onClick={onEdit}>
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      <div className="person-main">
        {editing && (
          <div className="card-table card-table-wide">
            <div className="card-table-title">Name</div>
            <div className="card-field">
              <div className="card-field-label">Name</div>
              <div className="card-field-value">
                <input
                  aria-label="Name"
                  value={person.name}
                  onChange={(e) => onChange("name", e.target.value)}
                />
              </div>
            </div>
            <div className="card-field">
              <div className="card-field-label">Photo URL</div>
              <div className="card-field-value">
                <input
                  aria-label="Photo URL"
                  value={person.photo_url ?? ""}
                  placeholder="Google Drive link"
                  onChange={(e) => onChange("photo_url", e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="card-tables">
          <FieldTable
            title="Personal Information"
            fields={PERSONAL}
            person={person}
            editing={editing}
            onChange={onChange}
          />
          <FieldTable
            title="General Information"
            fields={GENERAL}
            person={person}
            editing={editing}
            onChange={onChange}
          />
        </div>

        <div className="card-notes">
          {NOTES.map(([field, label]) => (
            <div className="card-note" key={field}>
              <div className="card-note-label">{label}</div>
              <div className="card-note-value">
                {editing ? (
                  <textarea
                    aria-label={label}
                    value={person[field] ?? ""}
                    rows={3}
                    onChange={(e) => onChange(field, e.target.value)}
                  />
                ) : (
                  person[field] || <span className="card-empty">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
