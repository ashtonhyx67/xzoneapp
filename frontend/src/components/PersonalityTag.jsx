import React from "react";
import AnimalDoodle, { ANIMALS } from "./AnimalDoodle.jsx";

// Someone's type wherever it appears beside their name.
export default function PersonalityTag({ type }) {
  if (!ANIMALS[type]) return null;

  return (
    <span className="personality-tag" title={`${type}: ${ANIMALS[type]}`}>
      <AnimalDoodle type={type} className="doodle-tiny" />
      {type} · {ANIMALS[type]}
    </span>
  );
}
