import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
      .dashboardSummary(token, controller.signal)
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
      <header className="page-head">
        <h1 className="page-title">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
        {canView && (
          <Link className="btn btn-secondary btn-inline" to="/members">
            All members
          </Link>
        )}
      </header>

      {summaryError && <div className="error-banner">{summaryError}</div>}

      {!canView ? (
        <div className="panel">
          <div className="panel-title">Your account is waiting for access.</div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            {(summary?.stats ?? []).map((stat) => (
              <div className="stat-card" key={stat.label}>
                <div className="stat-label">{stat.label}</div>
                <div className="stat-value">{stat.value}</div>
              </div>
            ))}
          </div>

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
