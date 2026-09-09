import React from "react";

// One search box, used wherever there is something to search. The magnifier is
// the label — a box with a glass in it is understood without the word "Search"
// sitting in it, and the placeholder was the only thing making the two boxes in
// this app look different from each other.
export default function SearchBox({ value, onChange, label = "Search" }) {
  return (
    <div className="search-box">
      <svg className="search-box-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line
          x1="10.4"
          y1="10.4"
          x2="14"
          y2="14"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <input
        className="search-box-input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  );
}
