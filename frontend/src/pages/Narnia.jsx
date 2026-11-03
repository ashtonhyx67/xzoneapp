import React, { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { usePoll } from "../lib/usePoll.js";
import AppShell from "../components/AppShell.jsx";
import NarniaPhotos from "../components/NarniaPhotos.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

const POLL_MS = 15000;

// The same page for everyone: each room, the photo of how it should look, what to
// use and what to do. Running a BM and editing all of this is under Admin.
export default function Narnia() {
  const { token } = useAuth();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setOverview(await api.narnia(token));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  usePoll(load, POLL_MS);

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title">Narnia BM</h1>
      </header>

      {error && !overview && <div className="error-banner">{error}</div>}

      {overview?.myCode && (
        <Link className="panel narnia-my-job" to={`/narnia/in/${overview.myCode}`}>
          <strong>See my job</strong>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      {overview?.running && !overview.myCode && (
        <div className="panel narnia-my-job">
          <strong>BM is on now. Scan the QR code to check in.</strong>
        </div>
      )}

      {!overview ? (
        !error && <SkeletonRows count={5} label="Loading Narnia BM" />
      ) : (
        <div className="narnia-rooms">
          {overview.rooms.map((room) => (
            <section className="panel narnia-room" key={room.id}>
              <h2 className="narnia-room-name-text">{room.name}</h2>
              <NarniaPhotos photos={room.photos} />

              {room.logistics.length > 0 && (
                <>
                  <h3 className="narnia-subhead">Logistics</h3>
                  <ul className="narnia-logistics">
                    {room.logistics.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}

              {room.tasks.length > 0 && (
                <>
                  <h3 className="narnia-subhead">What to do</h3>
                  <ul className="narnia-todo">
                    {room.tasks.map((task) => (
                      <li key={task.id}>{task.title}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
