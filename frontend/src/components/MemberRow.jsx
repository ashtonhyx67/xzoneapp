import React from "react";
import { Link } from "react-router-dom";
import { initials, photoSrc } from "../lib/photo.js";
import { roleClass } from "../lib/roles.js";

// One person, the same shape everywhere they are listed: on the dashboard under
// a heading, and in the member list beside the scorecard. Every row leads to
// that person's record, so the lists are a way into the database rather than a
// separate copy of it.
export default function MemberRow({ person, detail, badge, to, onClick, active = false }) {
  const photo = photoSrc(person.photo_url);

  const inner = (
    <>
      <span className="member-avatar">
        {photo ? <img src={photo} alt="" /> : initials(person.name)}
      </span>

      <span className="member-identity">
        <span className="member-name">{person.name}</span>
        {detail && <span className="member-detail">{detail}</span>}
      </span>

      {person.role && <span className={roleClass(person.role)}>{person.role}</span>}

      {badge && <span className={`badge ${badge.tone === "on" ? "badge-on" : "badge-off"}`}>{badge.text}</span>}
    </>
  );

  if (to) {
    return (
      <Link className={`member-row${active ? " active" : ""}`} to={to}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" className={`member-row${active ? " active" : ""}`} onClick={onClick}>
      {inner}
    </button>
  );
}
