import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { CGS, cgOf } from "../lib/teams.js";
import { useWeek } from "../lib/useWeek.js";
import {
  BUILTIN_STATUSES,
  CATEGORIES,
  CATEGORY_KEYS,
  categoryOf,
  defaultTitle,
  isPresent,
  telegramTeam,
  toTelegram,
  fromTelegram,
  parseNameList,
  telegramHeading,
} from "../lib/attendance.js";
import AppShell from "../components/AppShell.jsx";
import { SkeletonRows, Ticker } from "../components/Skeleton.jsx";
import WeekPicker from "../components/WeekPicker.jsx";
import WeeklyTabs from "../components/WeeklyTabs.jsx";

const SAVE_DELAY = 700;

let counter = 0;
const newKey = () => `new-${(counter += 1)}`;

// One person's line. Memoised because a register can run to forty people and a
// tap changes exactly one of them — without this, every row and every mark on
// the page re-rendered on each tap, which is what made marking feel sticky.
// Toggling replaces only the person it touched, so every other row keeps its
// identity and React skips it.
const RegisterRow = React.memo(function RegisterRow({
  person,
  statuses,
  canEdit,
  onToggle,
  onRename,
  onRemove,
}) {
  const here = isPresent(person.statuses, statuses);

  return (
    <div className={`register-row${here ? " register-row-present" : ""}`}>
      {canEdit && !person.fromTeam ? (
        <input
          className="register-name"
          list="attendance-names"
          value={person.name}
          placeholder="Name"
          aria-label="Name"
          onChange={(e) => onRename(person.key, e.target.value)}
        />
      ) : (
        // Someone with a record: their name belongs to it, so it is changed
        // there rather than here.
        <span className="register-name-text">{person.name}</span>
      )}

      {/* Toggles rather than a dropdown: someone can be at more than one thing
          in a week, and a tap is quicker than opening a list on a phone. */}
      <span className="register-marks">
        {statuses.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`mark${person.statuses.includes(s.key) ? " mark-on" : ""}`}
            disabled={!canEdit}
            aria-pressed={person.statuses.includes(s.key)}
            title={s.label + (s.counts ? "" : " (not counted)")}
            aria-label={`${s.label} for ${person.name || "this person"}`}
            onClick={() => onToggle(person.key, s.key)}
          >
            {s.emoji || s.label.slice(0, 2)}
          </button>
        ))}
      </span>

      {/* Only a name added by hand can be taken off. Anyone with a record is
          always listed; not coming is what an empty row of marks means. */}
      {canEdit && !person.fromTeam && (
        <button
          className="sheet-remove"
          onClick={() => onRemove(person.key)}
          aria-label={`Remove ${person.name || "this row"}`}
          title="Remove from this week"
        >
          ×
        </button>
      )}
    </div>
  );
});

// One week's register for one team, laid out the way the sheet is written:
// people grouped by their role, a count on each group, and the total across the
// top. A person can carry more than one status, so the statuses are toggles.
export default function Attendance() {
  const { token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);

  const [team, setTeam] = useState("");
  const [when, setWhen] = useWeek();
  const [record, setRecord] = useState(null);
  const [statuses, setStatuses] = useState(BUILTIN_STATUSES);
  const [people, setPeople] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newStatus, setNewStatus] = useState({ label: "", emoji: "", counts: true });
  const [directory, setDirectory] = useState([]);
  // The whole CG's numbers, which is what actually gets reported. Kept apart
  // from the register below, which is one team's.
  const [cgCounts, setCgCounts] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | saving | error
  const [error, setError] = useState("");
  // The post for the chat, once the marking is done. Closed until asked for:
  // it is the last thing in the week, not part of marking.
  const [exporting, setExporting] = useState(false);
  // The post once it has been typed over — the heading usually, since "BF Week
  // 1" is a term's wording and not something the register knows. Null while it
  // has not been touched, so until then it follows the marks being made.
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState(false);
  // Reading a post from the chat back in: the text pasted, and what came of it.
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteReport, setPasteReport] = useState(null);
  // Adding a list of new people to the team's database, so they are on every
  // week's register from then on.
  const [listing, setListing] = useState(false);
  const [listText, setListText] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [listReport, setListReport] = useState(null);

  const timer = useRef(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!token || !canView) return;
    const controller = new AbortController();

    Promise.all([
      api.getTeams(token, controller.signal),
      api.getPeople(token, controller.signal),
    ])
      .then(([mine, all]) => {
        setDirectory(all.people);
        // Their own team first: every account may edit every team now, so the
        // first editable one is X3A for everybody, which would open every
        // leader on someone else's register.
        setTeam((current) => current || mine.mine[0] || mine.editable[0] || "");
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });

    return () => controller.abort();
  }, [token, canView]);

  useEffect(() => {
    if (!token || !team) return;
    const controller = new AbortController();
    let active = true;

    setRecord(null);
    api
      .getAttendance(token, { team, ...when }, controller.signal)
      .then((data) => {
        if (!active) return;
        setRecord(data);
        setStatuses(data.statuses ?? BUILTIN_STATUSES);
        setPeople(
          data.people.map((person) => ({
            key: `p-${person.id}`,
            personId: person.personId,
            name: person.name,
            statuses: person.statuses ?? [],
            category: person.category,
            fromTeam: person.fromTeam,
          }))
        );
        dirty.current = false;
        setError("");
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, team, when]);

  // A different week or team is a different post, so anything typed into the
  // last one belongs to the one that has gone.
  useEffect(() => {
    setDraft(null);
    setCopied(false);
    setPasteReport(null);
    setListReport(null);
  }, [team, when]);

  const cg = cgOf(team);

  // Re-read after every save as well as on load, so the group total follows the
  // marks being made rather than lagging a screen behind.
  const savedAt = record?.counts;
  useEffect(() => {
    if (!token || !cg) return;
    const controller = new AbortController();
    let active = true;

    api
      .getCgAttendance(token, { cg, ...when }, controller.signal)
      .then((data) => active && setCgCounts(data))
      .catch(() => {
        /* the team's own numbers are still shown */
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, cg, when, savedAt]);

  const canEdit = Boolean(record?.canEdit);

  const stateRef = useRef({ people });
  stateRef.current = { people };

  const flush = useCallback(async () => {
    if (!record?.canEdit) return;

    // A save is already going. Leave the work marked as outstanding and let the
    // one in flight pick it up when it lands — dropping out here without that
    // is what lost marks made while a save was on the wire.
    if (inFlight.current) return;
    if (!dirty.current) return;

    // Cleared before sending, not after: anything ticked from here on marks it
    // dirty again, so a mark made mid-request survives instead of being wiped
    // by the response to a request that predates it.
    dirty.current = false;

    const { people: rows } = stateRef.current;
    // A nameless row is still being typed; it is not ready to be written.
    const ready = rows.filter((row) => row.name.trim());

    inFlight.current = true;
    setStatus("saving");
    try {
      const saved = await api.saveAttendance(token, {
        team,
        year: when.year,
        week: when.week,
        people: ready.map((row) => ({
          personId: row.personId ?? null,
          name: row.name,
          statuses: row.statuses,
          category: row.category,
        })),
      });
      // Anyone the server put back — added to the team since this page was
      // loaded — is taken on. Merged rather than replacing the list wholesale,
      // so a mark made while the save was in the air is not overwritten by a
      // response that predates it. When there is nobody new the same array is
      // returned, so React has no re-render to do and marking stays smooth.
      setPeople((list) => {
        const known = new Set(list.map((row) => row.personId).filter(Boolean));
        const added = (saved.people ?? [])
          .filter((person) => person.personId && !known.has(person.personId))
          .map((person) => ({
            key: `p-${person.id}`,
            personId: person.personId,
            name: person.name,
            statuses: person.statuses ?? [],
            category: person.category,
            fromTeam: person.fromTeam,
          }));
        return added.length ? [...list, ...added] : list;
      });

      // New counts are what tells the CG total above to fetch again; without
      // this it kept showing the numbers from when the page was opened.
      if (saved.counts) setRecord((current) => (current ? { ...current, counts: saved.counts } : current));

      setStatus("idle");
      setError("");
    } catch (err) {
      // Still unsaved, so it must go out again rather than be forgotten.
      dirty.current = true;
      setError(err.message);
      setStatus("error");
    } finally {
      inFlight.current = false;
      // Whatever was ticked while this was in the air, or a failed write worth
      // retrying.
      if (dirty.current) setTimeout(() => flushRef.current(), 200);
    }
  }, [record, team, token, when]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flushRef.current();
    }, SAVE_DELAY);
  }, []);

  // A pending write must not be lost on the way out. Empty deps: unmount only.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flushRef.current();
      }
    };
  }, []);

  const update = useCallback(
    (key, patch) => {
      setPeople((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));
      schedule();
    },
    [schedule]
  );

  const setName = useCallback((key, name) => {
    const match = directory.find(
      (person) => person.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    // Matching a record links the row to it, which is what makes the group
    // follow the person rather than being restated every week. A name that
    // matches nothing keeps the group it was added under — clearing it would
    // throw a guest into "No category" on the first keystroke, before they had
    // finished typing their own name.
    update(key, {
      name,
      personId: match?.id ?? null,
      ...(match ? { category: categoryOf(match.role) } : {}),
    });
  }, [directory, update]);

  // A person can be at more than one thing in a week, so a status is toggled
  // rather than chosen. Wrapped so its identity is stable: a row below is
  // memoised, and a callback rebuilt every render would defeat that.
  const toggleStatus = useCallback((personKey, statusKey) => {
    // The order marks are offered in, so a row always reads the same way.
    const order = statuses.map((s) => s.key);
    const rank = (key) => {
      const index = order.indexOf(key);
      // A mark the register no longer offers keeps its place at the end rather
      // than being dropped. Rebuilding the row from the offered list instead is
      // what made ticking one box clear another.
      return index === -1 ? order.length : index;
    };

    setPeople((list) =>
      list.map((row) => {
        if (row.key !== personKey) return row;
        const next = row.statuses.includes(statusKey)
          ? row.statuses.filter((key) => key !== statusKey)
          : [...row.statuses, statusKey];
        return { ...row, statuses: next.sort((a, b) => rank(a) - rank(b)) };
      })
    );
    schedule();
  }, [statuses, schedule]);

  const removePerson = useCallback(
    (personKey) => {
      setPeople((list) => list.filter((row) => row.key !== personKey));
      schedule();
    },
    [schedule]
  );

  async function addStatus(event) {
    event.preventDefault();
    if (!newStatus.label.trim()) return;
    setError("");
    try {
      const { statuses: saved } = await api.addAttendanceStatus(token, newStatus);
      setStatuses(saved);
      setNewStatus({ label: "", emoji: "", counts: true });
      setAdding(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeStatus(key) {
    setError("");
    try {
      const { statuses: saved } = await api.removeAttendanceStatus(token, key);
      setStatuses(saved);
      setPeople((list) =>
        list.map((row) => ({ ...row, statuses: row.statuses.filter((k) => k !== key) }))
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function addPerson(category) {
    setPeople((list) => [
      ...list,
      { key: newKey(), personId: null, name: "", statuses: [], category },
    ]);
  }

  // The register, grouped the way the sheet groups it. Anyone whose category is
  // not set yet gets their own block at the end rather than being dropped.
  const groups = useMemo(() => {
    const blocks = CATEGORIES.map((category) => ({
      ...category,
      people: people.filter((person) => person.category === category.key),
    }));

    const ungrouped = people.filter((person) => !CATEGORY_KEYS.includes(person.category));
    if (ungrouped.length > 0) {
      blocks.push({
        key: "",
        label: "No category",
        description: "Set a category on their record so they are counted",
        people: ungrouped,
      });
    }

    return blocks;
  }, [people]);

  // Counted here as well as on the server so the numbers move as boxes are
  // ticked, rather than waiting for the save to come back.
  const total = useMemo(
    () => people.filter((person) => isPresent(person.statuses, statuses)).length,
    [people, statuses]
  );

  // Rebuilt as marks are made, so the post is never a snapshot of the register
  // as it was when the panel was opened. A nameless row is still being typed.
  const post = useMemo(
    () =>
      toTelegram({
        title: defaultTitle({ team, ...when }),
        people: people.filter((person) => person.name.trim()),
        statuses,
      }),
    [team, when, people, statuses]
  );

  const text = draft ?? post;

  // Fills this register from a post in the chat's shape. The post says which
  // team and week it is, so pasting last week's into this week is refused
  // rather than quietly overwriting the wrong register.
  function applyPaste() {
    const heading = telegramHeading(pasteText);
    const here = telegramTeam(team);
    if (heading.team && heading.team !== here) {
      setError(`That post is for ${heading.team}. Switch to it above, then paste again.`);
      return;
    }
    if (heading.week && heading.week !== when.week) {
      setError(`That post is for Week ${heading.week}. Switch to it above, then paste again.`);
      return;
    }

    const { people: rows, report } = fromTelegram({
      text: pasteText,
      people,
      statuses,
      newKey,
    });
    if (report.read === 0) {
      setError("No names found. Paste the whole post, from the title down to NF.");
      return;
    }

    // A name that is in the database is linked to it, as typing it would.
    const linked = rows.map((row) => {
      if (row.personId) return row;
      const match = directory.find(
        (person) => person.name.trim().toLowerCase() === row.name.trim().toLowerCase()
      );
      return match ? { ...row, personId: match.id, category: categoryOf(match.role) } : row;
    });

    setError("");
    setPeople(linked);
    schedule();
    setPasteReport(report);
    setPasting(false);
    setPasteText("");
  }

  // "cheyenne tan" is written as typed in a hurry; the database keeps names
  // capitalised. A word already capitalised, or with capitals inside, is left.
  const tidyName = (name) =>
    name.replace(/(^|[\s-])(\p{Ll})/gu, (_, gap, letter) => gap + letter.toUpperCase());

  // Each person becomes a record in this team, as an NF unless they are
  // already in the database. A register is built from the team's people, so
  // that is what puts them on every week from now on, not just this one.
  async function addList() {
    const { title, people: listed } = parseNameList(listText);
    if (listed.length === 0) {
      setError("No names found. Put the names under a heading like \"Friends : 3\".");
      return;
    }

    setListBusy(true);
    setError("");
    const known = new Map(directory.map((person) => [person.name.trim().toLowerCase(), person]));
    const added = [];
    const already = [];
    const failed = [];

    for (const entry of listed) {
      const name = tidyName(entry.name);
      const existing = known.get(name.toLowerCase());
      if (existing) {
        already.push(`${existing.name}${existing.team_key ? ` (${existing.team_key})` : ""}`);
        continue;
      }
      try {
        const { person } = await api.createPerson(token, {
          name,
          role: "NF",
          team_key: team,
          invited_by: entry.invitedBy,
          general_information: [title, entry.section].filter(Boolean).join(" · "),
        });
        known.set(name.toLowerCase(), person);
        added.push(person);
      } catch (err) {
        failed.push(`${name}: ${err.message}`);
      }
    }

    if (added.length > 0) {
      setDirectory((list) => [...list, ...added]);
      // On this week straight away; the server puts them on every other week
      // as each one is opened.
      setPeople((list) => [
        ...list,
        ...added.map((person) => ({
          key: newKey(),
          personId: person.id,
          name: person.name,
          statuses: [],
          category: categoryOf(person.role),
          fromTeam: true,
        })),
      ]);
      schedule();
    }

    setListReport({ added: added.map((person) => person.name), already, failed });
    setListBusy(false);
    if (failed.length === 0) {
      setListing(false);
      setListText("");
    }
  }

  async function copyPost() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission, or an http origin on a phone. Selecting it is
      // then the only thing left, so the text is held open and selected rather
      // than the copy silently doing nothing.
      setError("Could not copy — the text is selected, so copy it by hand.");
    }
  }

  if (!canView) {
    return (
      <AppShell>
        <header className="page-head">
          <h1 className="page-title">Attendance</h1>
        </header>
        <div className="panel">
          <div className="panel-title">You do not have access to this.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <WeeklyTabs />

      <div className="panel">
        <div className="attendance-toolbar">
          {/* Week and team sit together: they are the two things that decide
              which register is on screen, so they read as one control. */}
          <div className="picker-box">
            <WeekPicker value={when} onChange={setWhen} />

            <span className="picker-divider" aria-hidden="true" />

            <select
              className="picker-team"
              aria-label="Team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            >
              {CGS.map((cg) => (
                <optgroup key={cg.key} label={`${cg.key} CG`}>
                  {cg.teams.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <span className="sheet-status">
            {status === "saving" ? "Saving…" : status === "error" ? "Not saved" : ""}
          </span>

          <div className="attendance-actions">
            {canEdit && (
              <button
                type="button"
                className="btn btn-secondary btn-inline"
                onClick={() => {
                  setListing((open) => !open);
                  setPasting(false);
                  setExporting(false);
                }}
              >
                {listing ? "Close" : "Add people"}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn btn-secondary btn-inline"
                onClick={() => {
                  setPasting((open) => !open);
                  setListing(false);
                  setExporting(false);
                }}
              >
                {pasting ? "Close" : "Paste from Telegram"}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-inline"
              onClick={() => {
                setExporting((open) => !open);
                setPasting(false);
                setListing(false);
              }}
            >
              {exporting ? "Close" : "Export for Telegram"}
            </button>
          </div>
        </div>

        {error && <div className="error-banner panel-notice">{error}</div>}

        {pasting && record && (
          <div className="export-box">
            <div className="export-head">
              <span className="export-title">Paste from Telegram</span>
              <button
                type="button"
                className="btn btn-primary btn-inline"
                onClick={applyPaste}
                disabled={!pasteText.trim()}
              >
                Fill register
              </button>
            </div>
            <p className="paste-hint">
              Paste the whole post for {telegramTeam(team)} Week {when.week}. Marks replace
              what is ticked now, and anyone not in the post is left unmarked.
            </p>
            <textarea
              className="export-text"
              aria-label="The post from Telegram"
              spellCheck={false}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {listing && record && (
          <div className="export-box">
            <div className="export-head">
              <span className="export-title">Add people to {team}</span>
              <button
                type="button"
                className="btn btn-primary btn-inline"
                onClick={addList}
                disabled={!listText.trim() || listBusy}
              >
                {listBusy ? <span className="spinner" /> : "Add"}
              </button>
            </div>
            <p className="paste-hint">
              Paste a list with names under headings like "Friends : 3". Each new name is added
              to the {team} database as NF, with anyone in brackets saved as who invited them,
              and shows up on every week's register.
            </p>
            <textarea
              className="export-text"
              aria-label="The list of people"
              spellCheck={false}
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {listReport && (
          <div className="paste-report panel-notice">
            <div className="paste-report-head">
              <strong>
                Added {listReport.added.length}{" "}
                {listReport.added.length === 1 ? "person" : "people"} to {team}.
              </strong>
              <button type="button" className="link-btn" onClick={() => setListReport(null)}>
                Done
              </button>
            </div>
            {listReport.added.length > 0 && <p>{listReport.added.join(", ")}.</p>}
            {listReport.already.length > 0 && (
              <p>Already in the database, so not added again: {listReport.already.join(", ")}.</p>
            )}
            {listReport.failed.length > 0 && (
              <p className="paste-report-failed">Not added: {listReport.failed.join("; ")}</p>
            )}
          </div>
        )}

        {pasteReport && (
          <div className="paste-report panel-notice">
            <div className="paste-report-head">
              <strong>Filled in from Telegram: {pasteReport.read} people.</strong>
              <button type="button" className="link-btn" onClick={() => setPasteReport(null)}>
                Done
              </button>
            </div>
            {pasteReport.added.length > 0 && (
              <p>
                Not on this register before, so added: {pasteReport.added.join(", ")}.
              </p>
            )}
            {pasteReport.cleared > 0 && (
              <p>
                {pasteReport.cleared} {pasteReport.cleared === 1 ? "person" : "people"} not in
                the post had marks, now cleared.
              </p>
            )}
            {pasteReport.unknownMarks.map(({ mark, label, names }) => (
              <p key={mark}>
                {label ? (
                  <>
                    {mark} {label} is not a status here yet, so {names.join(", ")}{" "}
                    {names.length === 1 ? "was" : "were"} not marked for it. Add it with{" "}
                    <strong>+ Status</strong> (emoji {mark}), then paste again.
                  </>
                ) : (
                  <>
                    {mark} is not a status, so {names.join(", ")}{" "}
                    {names.length === 1 ? "is" : "are"} left unmarked.
                  </>
                )}
              </p>
            ))}
            {pasteReport.notes.length > 0 && (
              <p>Notes in brackets are not kept: {pasteReport.notes.join(", ")}.</p>
            )}
          </div>
        )}

        {/* The register as the chat wants it. Editable before it is copied —
            the heading carries a term and its week, which is wording this app
            has no way to know. */}
        {exporting && record && (
          <div className="export-box">
            <div className="export-head">
              <span className="export-title">Telegram</span>
              <button
                type="button"
                className="btn btn-primary btn-inline"
                onClick={copyPost}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              {draft !== null && (
                <button type="button" className="link-btn" onClick={() => setDraft(null)}>
                  Reset
                </button>
              )}
            </div>
            <textarea
              className="export-text"
              aria-label="The post for Telegram"
              spellCheck={false}
              value={text}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
        )}

        {!record ? (
          <SkeletonRows count={8} label="Loading the register" />
        ) : (
          <>
            <div className="tally">
              <div className="tally-total">
                {/* The CG's number, because that is the one that gets
                    reported. The register underneath is this team's. */}
                <span className="tally-total-label">
                  Total attendance{cg ? ` (${cg})` : ""}
                </span>
                <Ticker
                  className="tally-total-value"
                  value={cgCounts ? cgCounts.counts.total : total}
                />
              </div>

              {/* Which team the group's number is made of. No use knowing the
                  CG is down without seeing which half. */}
              {cgCounts && cgCounts.teams.length > 1 && (
                <div className="tally-teams">
                  {cgCounts.teams.map((entry) => (
                    <span
                      className={`tally-team${entry.team === team ? " tally-team-current" : ""}`}
                      key={entry.team}
                    >
                      {entry.team}
                      <strong>{entry.counts.total}</strong>
                    </span>
                  ))}
                </div>
              )}

              <div className="tally-groups">
                {CATEGORIES.map((category) => {
                  const group = cgCounts?.counts.byCategory[category.key];
                  const listed = people.filter((p) => p.category === category.key);
                  const here = listed.filter((p) => isPresent(p.statuses, statuses)).length;
                  return (
                    <div className="tally-group" key={category.key} title={category.description}>
                      <span className="tally-group-name">{category.label}</span>
                      <span className="tally-group-value">
                        {group ? group.present : here}
                      </span>
                      <span className="tally-group-of">
                        / {group ? group.listed : listed.length}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* The legend sits with the button that adds to it, so what the
                marks mean and how to add one are in the same place. */}
            <div className="legend-bar">
              <div className="legend-items">
                {statuses.map((s) => (
                  <span
                    className={`legend-chip${s.counts ? "" : " legend-chip-muted"}`}
                    key={s.key}
                    title={s.counts ? "Counts towards the total" : "Not counted"}
                  >
                    <span className="legend-chip-emoji">{s.emoji || "•"}</span>
                    {s.label}
                  </span>
                ))}
              </div>

              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-inline legend-add"
                  onClick={() => setAdding((open) => !open)}
                >
                  {adding ? "Cancel" : "+ Status"}
                </button>
              )}
            </div>

            {/* A status added here applies to every register, because one week
                is read next to another. */}
            {canEdit && adding && (
              <form className="status-form" onSubmit={addStatus}>
                <input
                  className="status-form-emoji"
                  value={newStatus.emoji}
                  maxLength={4}
                  placeholder="🎯"
                  aria-label="Emoji"
                  onChange={(e) => setNewStatus((v) => ({ ...v, emoji: e.target.value }))}
                />
                <input
                  className="status-form-label"
                  value={newStatus.label}
                  placeholder="Name"
                  aria-label="Status name"
                  onChange={(e) => setNewStatus((v) => ({ ...v, label: e.target.value }))}
                />
                <label className="status-form-counts">
                  <input
                    type="checkbox"
                    checked={newStatus.counts}
                    onChange={(e) => setNewStatus((v) => ({ ...v, counts: e.target.checked }))}
                  />
                  Counts towards the total
                </label>
                <button className="btn btn-primary btn-inline" type="submit">
                  Add
                </button>
              </form>
            )}

            {canEdit && statuses.some((s) => !s.builtin) && (
              <div className="status-extras">
                {statuses
                  .filter((s) => !s.builtin)
                  .map((s) => (
                    <span className="status-extra" key={s.key}>
                      {s.emoji} {s.label}
                      <button
                        className="seat-remove"
                        onClick={() => removeStatus(s.key)}
                        aria-label={`Remove the ${s.label} status`}
                        title="Remove this status everywhere"
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            )}

            {groups.map((group) => (
              <section className="register-group" key={group.key || "none"}>
                <div className="register-group-head">
                  <h3 className="register-group-title" title={group.description}>
                    {group.label}
                  </h3>
                  <span className="register-group-count">
                    {group.people.filter((person) => isPresent(person.statuses, statuses)).length}
                  </span>
                  <span className="register-group-listed">of {group.people.length}</span>

                  {canEdit && group.key && (
                    <button className="link-btn" onClick={() => addPerson(group.key)}>
                      + Add
                    </button>
                  )}
                </div>

                {group.people.length > 0 && (
                  <div className="register-rows">
                    {group.people.map((person) => (
                      <RegisterRow
                        key={person.key}
                        person={person}
                        statuses={statuses}
                        canEdit={canEdit}
                        onToggle={toggleStatus}
                        onRename={setName}
                        onRemove={removePerson}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}

            <datalist id="attendance-names">
              {directory.map((person) => (
                <option key={person.id} value={person.name} />
              ))}
            </datalist>
          </>
        )}
      </div>
    </AppShell>
  );
}
