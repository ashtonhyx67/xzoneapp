import React, { useMemo, useState } from "react";
import {
  eventSummary,
  googleCalendarUrl,
  icsFile,
  icsFilename,
  isValidEvent,
} from "../lib/calendar.js";

// The coming Saturday, which is when most of what gets scheduled here happens.
// Today, if today is already Saturday.
function nextSaturday() {
  const day = new Date();
  day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7));
  const pad = (n) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

const BLANK = {
  title: "",
  date: nextSaturday(),
  start: "16:00",
  end: "18:00",
  location: "",
  details: "",
  allDay: false,
};

// Putting something in the team's calendars.
//
// The app cannot send an invite — there is no mail server and most members
// have a Telegram handle rather than an email address on file. So it builds
// the event once and hands back the two things that do reach people: a link
// for the group chat, and a file for anyone not on Google. Whoever opens
// either one saves it to their own calendar.
export default function EventInvite() {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState(BLANK);
  const [copied, setCopied] = useState("");

  const ready = isValidEvent(event);
  const link = useMemo(() => (ready ? googleCalendarUrl(event) : ""), [event, ready]);
  const when = eventSummary(event);

  const set = (field) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setEvent((prev) => ({ ...prev, [field]: value }));
    setCopied("");
  };

  // What gets pasted into the chat: the event in words, then the link. A bare
  // URL tells nobody what they are about to add to their calendar.
  const message = ready
    ? [event.title.trim(), when, event.location.trim(), "", link]
        .filter((line, i) => line || i === 3)
        .join("\n")
    : "";

  async function copy(what, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("failed");
    }
  }

  function download() {
    const blob = new Blob([icsFile(event)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = icsFilename(event);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: Safari has not finished with the URL by the
    // time click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="panel event-panel">
      <div className="panel-row">
        <div>
          <div className="panel-title">Put something in the calendar</div>
          <p className="panel-note">
            Build the event, then paste the link in the group — whoever taps it saves it to
            their own calendar.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-inline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "New event"}
        </button>
      </div>

      {open && (
        <div className="event-form">
          <div className="field">
            <label htmlFor="event-title">What is it</label>
            <input
              id="event-title"
              value={event.title}
              placeholder="X3A — Week 44"
              onChange={set("title")}
            />
          </div>

          <div className="event-when">
            <div className="field">
              <label htmlFor="event-date">Date</label>
              <input id="event-date" type="date" value={event.date} onChange={set("date")} />
            </div>

            {!event.allDay && (
              <>
                <div className="field">
                  <label htmlFor="event-start">From</label>
                  <input
                    id="event-start"
                    type="time"
                    value={event.start}
                    onChange={set("start")}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-end">To</label>
                  <input id="event-end" type="time" value={event.end} onChange={set("end")} />
                </div>
              </>
            )}
          </div>

          <label className="event-allday">
            <input type="checkbox" checked={event.allDay} onChange={set("allDay")} />
            All day
          </label>

          <div className="field">
            <label htmlFor="event-location">Where</label>
            <input
              id="event-location"
              value={event.location}
              placeholder="Hall 2"
              onChange={set("location")}
            />
          </div>

          <div className="field">
            <label htmlFor="event-details">Anything else</label>
            <textarea
              id="event-details"
              className="event-details"
              rows={2}
              value={event.details}
              placeholder="Bring a friend"
              onChange={set("details")}
            />
          </div>

          {/* The event as it will read once it is somewhere else. Shown rather
              than described, so a wrong date is caught here and not after
              forty people have already saved it. */}
          {ready ? (
            <div className="event-preview">
              <div className="event-preview-title">{event.title.trim()}</div>
              <div className="event-preview-when">{when}</div>
              {event.location.trim() && (
                <div className="event-preview-where">{event.location.trim()}</div>
              )}
            </div>
          ) : (
            <div className="event-preview event-preview-empty">
              Give it a name and a time and the link appears here.
            </div>
          )}

          <div className="event-actions">
            <button
              type="button"
              className="btn btn-primary btn-inline"
              disabled={!ready}
              onClick={() => copy("message", message)}
            >
              {copied === "message" ? "Copied" : "Copy for the group"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-inline"
              disabled={!ready}
              onClick={() => copy("link", link)}
            >
              {copied === "link" ? "Copied" : "Copy link only"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-inline"
              disabled={!ready}
              onClick={download}
            >
              Download .ics
            </button>
            {ready && (
              <a
                className="link-btn event-open"
                href={link}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Calendar
              </a>
            )}
          </div>

          {copied === "failed" && (
            <div className="error-banner panel-notice">
              Could not reach the clipboard. Use “Open in Google Calendar” instead.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
