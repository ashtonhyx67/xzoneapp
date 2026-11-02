import React, { useId } from "react";

// Mirrors the animal names in backend/lib/personality.js. Screens that only have
// a type code (the member list, the accounts list) read them from here; the
// result screen gets its wording from the server.
export const ANIMALS = {
  ISTJ: "German Shepherd",
  ISFJ: "Elephant",
  INFJ: "Whale",
  INTJ: "Owl",
  ISTP: "Cat",
  ISFP: "Rabbit",
  INFP: "Deer",
  INTP: "Octopus",
  ESTP: "Cheetah",
  ESFP: "Parrot",
  ENFP: "Otter",
  ENTP: "Fox",
  ESTJ: "Beaver",
  ESFJ: "Golden Retriever",
  ENFJ: "Dolphin",
  ENTJ: "Lion",
};

// Each animal is a few pen strokes on a 100 by 100 sheet. `lines` is the outline;
// `scribble` is shading, drawn heavier. A pupil is a zero-length line, which the
// round line cap turns into a dot.
const DRAWINGS = {
  ISTJ: {
    lines: [
      "M22 52C30 46 52 46 62 50C66 56 64 62 60 64C48 68 32 68 24 64C20 60 20 56 22 52",
      "M60 50C58 40 62 32 70 31C78 31 84 37 86 42C88 46 84 49 78 49C74 52 66 54 60 50",
      "M63 34L60 18L69 30",
      "M71 31L76 16L79 34",
      "M30 66L28 85M38 67L38 85M52 66L52 85M58 64L60 85",
      "M22 54C14 52 10 46 9 38",
      "M74 38h.1",
    ],
    scribble: ["M28 50L33 58L37 49L41 59L45 49L49 58L54 50", "M83 42l4 1l-3 3l-3-2z"],
  },
  ISFJ: {
    lines: [
      "M30 40C40 30 66 30 76 40C84 50 84 70 80 80L70 80L69 69C58 73 48 73 42 69L41 80L31 80C28 74 28 66 28 60",
      "M30 40C22 38 16 44 16 52C15 62 14 72 9 80L17 82C22 74 26 66 28 60",
      "M34 39C25 44 25 59 36 61C45 61 47 46 42 39",
      "M81 46C86 50 87 58 86 65",
      "M23 63L30 69",
      "M23 49h.1",
    ],
    scribble: ["M34 46L40 44M33 51L42 49M35 56L42 54"],
  },
  INFJ: {
    lines: [
      "M12 56C12 38 38 30 56 36C68 40 76 50 84 46",
      "M84 46C76 64 50 72 30 70C18 68 12 62 12 56",
      "M84 46C88 42 93 38 95 31M84 46C82 40 80 35 76 33",
      "M14 58C22 63 30 63 38 58",
      "M40 28C40 20 34 18 32 13M40 28C40 20 46 18 48 13",
      "M27 51h.1",
    ],
    scribble: ["M24 65L26 69M32 65L34 70M40 64L42 69M48 62L50 67"],
  },
  INTJ: {
    lines: [
      "M30 30L32 15L42 24C46 23 54 23 58 24L68 15L70 30C76 44 74 66 62 76C54 80 46 80 38 76C26 66 24 44 30 30",
      "M33 36a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
      "M51 36a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
      "M46 45L50 51L54 45Z",
      "M16 83C36 79 64 81 86 79",
      "M42 78v5M58 78v5",
      "M41 36h.1M59 36h.1",
    ],
    scribble: ["M38 59q3 4 6 0q3 4 6 0q3 4 6 0q3 4 6 0", "M42 67q3 4 6 0q3 4 6 0q3 4 6 0"],
  },
  ISTP: {
    lines: [
      "M31 21L34 38C30 46 34 56 50 56C66 56 70 46 66 38L69 21L56 31C52 30 48 30 44 31Z",
      "M39 40h7M54 40h7",
      "M50 49q-3 4-6 2M50 49q3 4 6 2",
      "M32 46L20 43M33 50L21 52M68 46L80 43M67 50L79 52",
      "M38 56C30 66 30 80 36 87L64 87C70 80 70 66 62 56",
      "M46 87L46 71M54 87L54 71",
      "M66 85C80 87 87 76 80 65",
      "M43 42h.1M57 42h.1",
    ],
    scribble: ["M48 46L52 46L50 49Z", "M45 25L46 31M50 24L50 30M55 25L54 31"],
  },
  ISFP: {
    lines: [
      "M41 38C34 24 34 10 40 7C46 10 47 26 46 36",
      "M54 36C53 26 54 10 60 7C66 10 66 24 59 38",
      "M34 50C34 38 46 34 50 34C54 34 66 38 66 50C66 60 58 64 50 64C42 64 34 60 34 50",
      "M48 58h4v4h-4zM50 58v4",
      "M40 63C32 70 32 85 38 89L62 89C68 85 68 70 60 63",
      "M36 54L26 52M36 57L27 59M64 54L74 52M64 57L73 59",
      "M43 47h.1M57 47h.1",
    ],
    scribble: ["M48 52L52 52L50 55Z", "M40 14L41 26M60 14L59 26", "M67 80q6-3 7 3q-1 6-7 3"],
  },
  INFP: {
    lines: [
      "M24 56C32 50 56 50 64 54C68 60 66 66 62 68C50 72 34 72 26 68C22 64 22 60 24 56",
      "M60 53C62 44 64 38 66 32C68 26 76 26 82 30C86 33 86 37 82 38C78 39 74 40 72 42C70 48 68 54 64 58",
      "M66 31L57 26L64 36",
      "M70 27L68 13M68 14L62 8M68 19L75 13",
      "M77 28L80 14M80 15L86 10M79 20L73 14",
      "M30 70L28 89M38 71L38 89M52 71L52 89M60 69L62 89",
      "M24 56L16 51L22 61",
      "M74 33h.1",
      "M34 57h.1M42 60h.1M50 57h.1M38 64h.1M47 65h.1",
    ],
    scribble: ["M83 33l3 2l-3 2z"],
  },
  INTP: {
    lines: [
      "M28 44C28 19 72 19 72 44C72 53 66 58 62 60M38 60C34 58 28 53 28 44",
      "M38 60C30 66 20 64 16 72C14 78 20 81 22 76",
      "M43 61C40 70 34 76 32 84C31 90 38 90 38 85",
      "M48 62C48 72 46 80 48 88C50 92 54 90 53 86",
      "M53 62C55 72 60 78 62 86C63 90 69 88 67 83",
      "M58 61C64 68 72 66 78 72C82 78 77 82 74 78",
      "M62 60C70 60 80 58 86 62C90 66 86 70 83 67",
      "M37 40a6 6 0 1 0 12 0a6 6 0 1 0-12 0",
      "M51 40a6 6 0 1 0 12 0a6 6 0 1 0-12 0",
      "M49 39h2",
      "M43 40h.1M57 40h.1",
      "M45 52q5 4 10 0",
    ],
    scribble: [],
  },
  ESTP: {
    lines: [
      "M20 50C34 44 60 44 72 48",
      "M72 48C72 40 78 36 84 37C90 38 93 44 88 48C84 52 76 54 70 56",
      "M76 38L75 30L81 36",
      "M70 56C56 62 36 62 22 58C18 56 18 52 20 50",
      "M62 58L77 74M56 60L68 78M30 60L15 76M36 61L24 80",
      "M20 50C12 46 8 40 6 29",
      "M83 43h.1",
      "M30 50h.1M38 52h.1M46 49h.1M54 52h.1M62 50h.1M34 56h.1M44 57h.1M54 56h.1",
    ],
    scribble: ["M86 44L84 51", "M89 44l2 1l-2 2z"],
  },
  ESFP: {
    lines: [
      "M50 20C40 20 34 28 34 38C34 50 34 62 42 70C48 74 56 72 60 66C66 56 66 38 64 30C62 24 56 20 50 20",
      "M64 28C72 28 77 34 72 43C70 38 66 38 63 38",
      "M47 20L41 7M51 20L50 5M55 22L60 9",
      "M40 40C46 46 52 58 46 70C40 62 38 50 40 40",
      "M44 72L38 93M50 73L50 95M56 70L61 91",
      "M27 77C44 75 62 75 79 77",
      "M47 72v4M54 72v4",
      "M55 31a3 3 0 1 0 .1 0",
    ],
    scribble: ["M42 46L46 50M41 52L47 57M42 58L47 63", "M67 33L71 36M66 36L70 39"],
  },
  ENFP: {
    lines: [
      "M36 30C36 17 64 17 64 30C66 40 60 46 50 46C40 46 34 40 36 30",
      "M38 23C33 21 31 27 36 29M62 23C67 21 69 27 64 29",
      "M38 44C30 56 30 78 38 89L62 89C70 78 70 56 62 44",
      "M36 58C42 65 46 65 50 63M64 58C58 65 54 65 50 63",
      "M44 61q6-8 12 0q-6 6-12 0",
      "M62 87C76 91 86 85 88 72",
      "M50 38v2M50 40q-3 3-5 1M50 40q3 3 5 1",
      "M37 37L27 35M38 40L28 42M63 37L73 35M62 40L72 42",
      "M43 31h.1M57 31h.1",
    ],
    scribble: ["M47 36L53 36L50 39Z"],
  },
  ENTP: {
    lines: [
      "M26 18L30 44C34 56 44 64 50 70C56 64 66 56 70 44L74 18L60 31C54 29 46 29 40 31Z",
      "M30 44C38 44 46 50 50 58C54 50 62 44 70 44",
      "M37 39L45 43M63 39L55 43",
      "M44 66C40 74 40 86 44 92L58 92",
      "M60 72C78 66 92 76 86 88C78 96 62 94 56 84",
    ],
    scribble: ["M47 66L53 66L50 71Z", "M76 76L82 84L74 82L78 90L70 86", "M41 41h1M59 41h1"],
  },
  ESTJ: {
    lines: [
      "M30 34C30 18 70 18 70 34C72 46 62 52 50 52C38 52 28 46 30 34",
      "M33 23C27 19 25 28 31 30M67 23C73 19 75 28 69 30",
      "M46 46v7h8v-7M50 46v7",
      "M34 50C26 62 28 82 36 89L64 89C72 82 74 62 66 50",
      "M70 78C80 72 95 74 95 84C95 92 80 94 68 88",
      "M34 62C40 68 44 68 48 66M66 62C60 68 56 68 52 66",
      "M41 33h.1M59 33h.1",
    ],
    scribble: ["M46 39h8l-4 4z", "M76 78L80 90M83 76L87 89M90 77L79 83M92 84L72 86"],
  },
  ESFJ: {
    lines: [
      "M32 27C36 17 64 17 68 27C72 41 64 57 50 59C36 57 28 41 32 27",
      "M34 25C22 25 15 40 20 54C26 58 32 50 33 39",
      "M66 25C78 25 85 40 80 54C74 58 68 50 67 39",
      "M40 35q3-4 6 0M54 35q3-4 6 0",
      "M45 50q5 13 10 0",
      "M36 58C32 70 32 84 36 89L46 89L46 74M64 58C68 70 68 84 64 89L54 89L54 74",
      "M68 76C78 72 84 64 84 56",
      "M88 62L91 58M89 69L93 68",
    ],
    scribble: ["M47 42L53 42L50 46Z", "M38 62L42 70L46 64L50 72L54 64L58 70L62 62"],
  },
  ENFJ: {
    lines: [
      "M16 66C24 42 50 28 72 34C78 36 86 38 92 38C90 42 86 44 80 44C72 52 52 60 28 68",
      "M48 31L41 17L60 31",
      "M56 53L51 67L66 49",
      "M16 66L6 61M16 66L12 77M28 68L12 77M6 61L16 57",
      "M84 43q-4 2-8 1",
      "M73 39h.1",
      "M9 88q8-6 16 0q8 6 16 0q8-6 16 0q8 6 16 0q8-6 16 0",
    ],
    scribble: ["M34 56L38 60M42 53L46 57M50 50L54 54"],
  },
  ENTJ: {
    lines: [
      "M50 8L58 17L68 13L72 23L82 25L80 35L89 43L80 51L82 61L72 63L68 73L58 69L50 78L42 69L32 73L28 63L18 61L20 51L11 43L20 35L18 25L28 23L32 13L42 17Z",
      "M34 43a16 16 0 1 0 32 0a16 16 0 1 0-32 0",
      "M50 50v4M50 54q-4 4-8 1M50 54q4 4 8 1",
      "M38 74C36 82 37 92 40 93L60 93C63 92 64 82 62 74",
      "M50 80v13",
      "M43 40h.1M57 40h.1",
    ],
    scribble: ["M46 46h8l-4 4z", "M38 30L40 36M50 27V33M62 30L60 36"],
  },
};

// The wobble is what makes a clean path read as drawn by hand. It runs twice with
// different noise so each line gets gone over a second time, slightly off, the
// way a pen does. The ids are per instance because a page can show several, and
// a filter referenced by id from something hidden would hide them all.
export default function AnimalDoodle({ type, className = "" }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const drawing = DRAWINGS[type];
  if (!drawing) return null;

  const strokes = (
    <>
      {drawing.lines.map((d) => (
        <path key={d} d={d} strokeWidth="1.5" />
      ))}
      {drawing.scribble.map((d) => (
        <path key={d} d={d} strokeWidth="2.4" />
      ))}
    </>
  );

  return (
    <span className={`doodle ${className}`} role="img" aria-label={ANIMALS[type]}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <filter id={`${id}a`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" />
            <feDisplacementMap in="SourceGraphic" scale="2.6" />
          </filter>
          <filter id={`${id}b`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="11" />
            <feDisplacementMap in="SourceGraphic" scale="3.4" />
          </filter>
        </defs>
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <g filter={`url(#${id}a)`}>{strokes}</g>
          <g filter={`url(#${id}b)`} opacity="0.55">
            {strokes}
          </g>
        </g>
      </svg>
    </span>
  );
}
