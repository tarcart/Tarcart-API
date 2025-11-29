import express from "express";
import cors from "cors";
import path from "path";

import { pool } from "./db";
import stationsRouter from "./routes/stations";
import submissionsRouter from "./routes/submissions";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import analyticsRouter from "./routes/analytics";

const app = express();
const PORT = process.env.PORT || 8080;

// ---- Core middleware ----
app.use(cors());
app.use(express.json());

// Simple request logging so we can see traffic in DO logs
app.use((req, _res, next) => {
  console.log(`🚦 ${req.method} ${req.url}`);
  next();
});

// ---- Health checks ----
app.get("/health/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ DB health check failed:", err);
    res.status(500).json({ ok: false, error: "DB connection error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---- API routes ----
app.use("/api/analytics", analyticsRouter);
app.use("/api/stations", stationsRouter);
app.use("/api/price-submissions", submissionsRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

// ---- Static front-end (gas.html) ----
// dist/index.js will live in /dist
// gas.html lives in /public/gas.html
const publicDir = path.join(__dirname, "..", "public");

// Serve /gas and /gas.html
app.get(["/gas", "/gas.html"], (_req, res) => {
  res.sendFile(path.join(publicDir, "gas.html"));
});

// Also serve any other static assets from /public (if we add images/css later)
app.use(express.static(publicDir));

// Root just redirects to /gas so the console opens immediately
app.get("/", (_req, res) => {
  res.redirect("/gas");
});

// ---- 404 fallback for anything else not handled above ----
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Tarcart API listening on port ${PORT}`);
});
