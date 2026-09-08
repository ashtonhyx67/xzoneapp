require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const { initSchemaWithRetry } = require("./db");
const authRoutes = require("./routes/auth");
const rosterRoutes = require("./routes/roster");
const { requireAuth } = require("./middleware/auth");

if (!process.env.JWT_SECRET) {
  console.error(
    "JWT_SECRET is not set. Add it to your Railway service variables (or backend/.env locally)."
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4000;

let dbReady = false;

app.use(cors());
app.use(express.json());

// Railway pings this; it must answer even while the database is still coming up.
app.get("/api/health", (req, res) => {
  res.json({ ok: true, db: dbReady });
});

// Anything that touches Postgres should say so plainly rather than hanging.
app.use("/api", (req, res, next) => {
  if (!dbReady && req.path !== "/health") {
    return res
      .status(503)
      .json({ error: "The server is still starting up. Please try again in a moment." });
  }
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/roster", rosterRoutes);

// Example protected route for the dashboard to call.
// Add real endpoints here as the app grows (e.g. /api/projects, /api/team).
app.get("/api/dashboard/summary", requireAuth, async (req, res) => {
  res.json({
    message: "This data came from a protected backend route.",
    stats: [
      { label: "Members", value: 50 },
      { label: "Active today", value: 0 },
      { label: "Open items", value: 0 },
    ],
  });
});

// An unknown API route must not fall through to the SPA, or the frontend gets
// index.html where it expected JSON and reports a confusing parse error.
app.use("/api", (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// Anything a route threw lands here, so the client always gets JSON back
// instead of the request hanging open.
app.use("/api", (err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

// In production, serve the built React app from the same service.
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.join(__dirname, "..", "frontend", "dist");
  app.use(express.static(frontendDist));
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// Listen first so the platform sees a healthy port binding, then connect to the
// database. A slow or briefly unavailable database no longer kills the process.
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);
  dbReady = await initSchemaWithRetry();
  if (!dbReady) {
    console.error(
      "Could not reach the database after several attempts. The app is up but " +
        "every /api route will return 503 until DATABASE_URL points at a reachable Postgres."
    );
  }
});
