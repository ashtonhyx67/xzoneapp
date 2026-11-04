import React from "react";
import { Link } from "react-router-dom";
import { NavIcon } from "./AppShell.jsx";

// One icon and its name, the way the All page lays things out.
export default function AdminTile({ tile }) {
  const inner = (
    <>
      <NavIcon name={tile.icon} className="admin-tile-icon" />
      <span className="admin-tile-label">{tile.label}</span>
    </>
  );

  return tile.onClick ? (
    <button type="button" className="admin-tile" onClick={tile.onClick}>
      {inner}
    </button>
  ) : (
    <Link className="admin-tile" to={tile.to} state={tile.state}>
      {inner}
    </Link>
  );
}
