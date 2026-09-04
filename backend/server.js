require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const { initSchema } = require("./db");
const authRoutes = require("./routes/auth");
const { requireAuth } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

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

// In production, serve the built React app from the same service.
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.join(__dirname, "..", "frontend", "dist");
  app.use(express.static(frontendDist));
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
