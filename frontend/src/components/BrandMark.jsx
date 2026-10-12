import React from "react";

// The X. The same shape as the home-screen icon (scripts/generateIcons.cjs):
// the falling stroke heavy, the rising one light, both cut flat.
export default function BrandMark({ className = "" }) {
  return (
    <svg className={`brand-mark ${className}`} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="120" fill="var(--ink)" />
      <path
        fill="var(--mark)"
        d="M106.7 132H221.3L405.3 380H290.7ZM324.3 132H371.7L187.7 380H140.3Z"
      />
    </svg>
  );
}
