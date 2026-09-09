import React, { useState } from "react";
import { photoSrc, initials } from "../lib/photo.js";
import { ROLES, findRole, roleClass } from "../lib/roles.js";

// One white card: the photo and who they are on the left, the two field tables
// beside it, and the long-text rows running full width underneath so no corner
// of the card is left empty.
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
            {editing && field === "role" ? (
              <select
                aria-label={label}
                value={person.role ?? ""}
                onChange={(e) => onChange("role", e.target.value)}
              >
                <option value=""></option>
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
                {person.role && !findRole(person.role) && (
                  <option value={person.role}>{person.role}</option>
                )}
              </select>
            ) : editing && !READ_ONLY.has(field) ? (
              <input
                aria-label={label}
                type={field === "birthday" ? "date" : "text"}
                value={person[field] ?? ""}
                onChange={(e) => onChange(field, e.target.value)}
              />
            ) : field === "role" && person.role ? (
              <span className={roleClass(person.role)}>{person.role}</span>
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

        {/* Directly under the photo rather than floating in the card's corner:
            it belongs to the person you are looking at, and on a phone the
            corner put it a long way from them. */}
        {canEdit && (
          <div className="person-card-actions">
            {editing ? (
              <>
                <button className="card-btn" onClick={onCancel} disabled={saving}>
                  Cancel
                </button>
                <button
                  className="card-btn card-btn-save"
                  onClick={onSave}
                  disabled={saving}
                >
                  {saving ? "Saving" : "Save"}
                </button>
              </>
            ) : (
              <button className="card-btn" onClick={onEdit} aria-label="Edit this record">
                Edit
              </button>
            )}
          </div>
        )}

        <div className="person-heading">
          <div className="person-name">{person.name}</div>
          <div className="person-tags">
            {person.role && <span className={roleClass(person.role)}>{person.role}</span>}
            {person.team_key ? (
              <span className="team-pill">{person.team_key}</span>
            ) : (
              person.team && <span className="team-pill">Team {person.team}</span>
            )}
          </div>
        </div>

        {editing && (
          <div className="card-field card-field-stacked">
            <div className="card-field-label">Photo URL</div>
            <div className="card-field-value">
              <input
                aria-label="Photo URL"
                value={person.photo_url ?? ""}
                onChange={(e) => onChange("photo_url", e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="person-main">
        {editing && (
          <div className="card-table">
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
      </div>

      {/* Full width under both columns, so the space beside the photo is used
          rather than left blank. */}
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
  );
}
