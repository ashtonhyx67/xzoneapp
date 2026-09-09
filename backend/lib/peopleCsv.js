// Parsing and importing the people spreadsheet. Shared by the upload button in
// the app and by scripts/importPeople.js so both behave identically.

// The sheet's headers, mapped onto our columns. Matching is case- and
// space-insensitive so "XIII A Name " still lines up with "name".
const HEADER_MAP = {
  name: "name",
  xiiianame: "name",
  photo: "photo_url",
  photourl: "photo_url",
  role: "role",
  status: "role",
  team: "team",
  contact: "contact",
  telegram: "telegram",
  instagram: "instagram",
  ministry: "ministry",
  birthday: "birthday",
  followup: "follow_up",
  school: "school",
  camechurch: "came_church",
  invitedby: "invited_by",
  religion: "religion",
  generalinformation: "general_information",
  updates: "updates",
  nextsteps: "next_steps",
};

// Age is deliberately ignored: it is derived from birthday on read.
const IGNORED = new Set(["age", ""]);

const FIELDS = [
  "name", "photo_url", "role", "team", "contact", "telegram", "instagram",
  "ministry", "birthday", "follow_up", "school", "came_church", "invited_by",
  "religion", "general_information", "updates", "next_steps",
];

const key = (header) => String(header).toLowerCase().replace(/[^a-z]/g, "");

// A minimal RFC 4180 parser: handles quoted fields, escaped quotes and
// newlines inside cells, which the notes columns definitely contain.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  // A UTF-8 BOM would otherwise become part of the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// The sheet has a title banner above the real headers, so find the row that
// actually looks like a header rather than assuming row 1.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const keys = rows[i].map(key);
    const hasName = keys.some((k) => k.endsWith("name"));
    const hasKnownColumn = keys.some((k) => k !== "name" && HEADER_MAP[k]);
    if (hasName && hasKnownColumn) return i;
  }
  return -1;
}

// "6 Nov 2005", "17/3/2006" and ISO dates all appear in the sheet.
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseBirthday(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const named = value.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      return `${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    }
  }

  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  }

  return { unparsed: value };
}

// Turns raw CSV text into people, plus anything the caller should be told about.
function readPeopleCsv(text) {
  const rows = parseCsv(text);
  const headerIndex = findHeaderRow(rows);

  if (headerIndex === -1) {
    return {
      error:
        "Could not find the header row. Make sure you exported the Data tab, " +
        "and that it still has a Name column alongside Role, Contact and the rest.",
    };
  }

  const headers = rows[headerIndex];
  const columns = headers.map((h) => HEADER_MAP[key(h)] || null);
  const ignored = headers.filter((h, i) => !columns[i] && !IGNORED.has(key(h)));

  const people = [];
  const warnings = [];

  // Age is skipped on purpose, which is worth saying out loud — otherwise it
  // looks like the column failed to import.
  if (headers.some((h) => key(h) === "age")) {
    warnings.push("Age column skipped — age is calculated from Birthday, so it stays current.");
  }

  for (const row of rows.slice(headerIndex + 1)) {
    const person = {};
    columns.forEach((column, i) => {
      if (column) person[column] = String(row[i] ?? "").trim();
    });

    if (!person.name) continue;

    const parsed = person.birthday ? parseBirthday(person.birthday) : null;
    if (parsed && parsed.unparsed) {
      warnings.push(`${person.name}: could not read birthday "${parsed.unparsed}" — left blank`);
      person.birthday = null;
    } else {
      person.birthday = parsed;
    }

    // A name that appears twice would otherwise be inserted then immediately
    // overwritten, which reads as a silent loss.
    const clash = people.find((p) => p.name.toLowerCase() === person.name.toLowerCase());
    if (clash) {
      warnings.push(`${person.name} appears more than once — the last row wins`);
      Object.assign(clash, person);
      continue;
    }

    people.push(person);
  }

  if (people.length === 0) {
    return { error: "No rows with a name were found in that file." };
  }

  return { people, ignored, warnings };
}

// Upserts on name, so re-importing a corrected sheet updates rather than
// duplicating. Runs in one transaction: all of it lands, or none of it.
async function importPeople(pool, people) {
  const client = await pool.connect();
  let created = 0;
  let updated = 0;

  try {
    await client.query("BEGIN");

    const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(", ");
    // A blank cell in the import means "the sheet doesn't say", not "erase it".
    // Keep whatever is already on the record unless the file supplies a value,
    // so re-importing an old export can't undo edits made in the app since.
    const assignments = FIELDS.filter((f) => f !== "name")
      .map((f) =>
        f === "birthday"
          ? `${f} = COALESCE(EXCLUDED.${f}, people.${f})`
          : `${f} = COALESCE(NULLIF(EXCLUDED.${f}, ''), people.${f})`
      )
      .join(", ");

    for (const person of people) {
      const values = FIELDS.map((f) =>
        f === "birthday" ? person[f] ?? null : person[f] ?? ""
      );

      const result = await client.query(
        `INSERT INTO people (${FIELDS.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (lower(name)) DO UPDATE SET ${assignments}, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        values
      );

      if (result.rows[0].inserted) created++;
      else updated++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { created, updated };
}

module.exports = { readPeopleCsv, importPeople, FIELDS };
