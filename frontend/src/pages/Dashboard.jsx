import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AppShell from "../components/AppShell.jsx";
import MemberRow from "../components/MemberRow.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(birthday) {
  const [, month, day] = birthday.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function whenLabel(daysAway) {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `${daysAway} days`;
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ISO week number: weeks run Monday-Sunday, and week 1 is the one holding the
// first Thursday of the year. Doing it by hand keeps the app dependency-free.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Shift to the Thursday of this week, then count weeks from Jan 1.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// The top of the dashboard. Attendance and SA are recorded every week, so the
// week and the day are the first thing the page says.
function WeekBanner({ firstName, teams }) {
  // Tick over at midnight rather than only when the tab is reopened.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timer = setTimeout(() => setNow(new Date()), midnight - now + 1000);
    return () => clearTimeout(timer);
  }, [now]);

  const week = isoWeek(now);
  const dayName = DAYS[now.getDay()];
  const dateLine = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <section className="week-banner">
      <div className="week-banner-main">
        <div className="week-eyebrow">Week</div>
        <div className="week-number">{week}</div>
      </div>

      <div className="week-banner-side">
        <div className="week-day">{dayName}</div>
        <div className="week-date">{dateLine}</div>
        <div className="week-greeting">
          Welcome back{firstName ? `, ${firstName}` : ""}
        </div>
        <div className="week-tags">
          {/* Which teams these birthdays and follow-ups are for. Nothing shown
              while the summary is still loading, or for an account that has
              not been put on a team and is therefore seeing all of them. */}
          {teams.map((team) => (
            <span className="week-tag week-tag-team" key={team}>
              {team}
            </span>
          ))}
          <span className="week-tag">Attendance</span>
          <span className="week-tag">SA</span>
        </div>
      </div>
    </section>
  );
}

// A heading with the people it is about listed underneath, rather than a table
// of names. Every row opens that person's scorecard.
function MemberSection({ title, count, people, empty, renderDetail, renderBadge }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {count > 0 && <span className="section-count">{count}</span>}
      </div>

      {people.length === 0 ? (
        <div className="list-empty">{empty}</div>
      ) : (
        <div className="member-list">
          {people.map((person) => (
            <MemberRow
              key={person.id}
              person={person}
              detail={renderDetail?.(person)}
              badge={renderBadge?.(person)}
              to={`/members?person=${person.id}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  const { user, token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);

  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");

  const firstName = user?.name ? user.name.split(" ")[0] : "";

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();
    let active = true;

    api
      .dashboardSummary(token, null, controller.signal)
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setSummaryError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token]);

  const birthdays = summary?.birthdays ?? [];
  const followUps = summary?.followUps ?? [];

  return (
    <AppShell>
      <WeekBanner firstName={firstName} teams={summary?.scope ?? []} />

      {summaryError && <div className="error-banner">{summaryError}</div>}

      {!canView ? (
        <div className="panel">
          <div className="panel-title">Your account is waiting for access.</div>
        </div>
      ) : (
        <>
          <MemberSection
            title="Birthdays"
            count={birthdays.length}
            people={birthdays}
            empty="Nothing in the next 30 days"
            renderDetail={(person) => `${formatDay(person.birthday)} · turning ${person.turning}`}
            renderBadge={(person) => ({
              text: whenLabel(person.daysAway),
              tone: person.daysAway <= 1 ? "on" : "off",
            })}
          />

          <MemberSection
            title="Follow-ups"
            count={followUps.length}
            people={followUps}
            empty="Everyone is marked Done"
            renderDetail={(person) => (person.team ? `Team ${person.team}` : "")}
            renderBadge={(person) => ({ text: person.status, tone: "off" })}
          />
        </>
      )}
    </AppShell>
  );
}
