import express from "express";
import cors from "cors";
import path from "path";

import stationsRouter from "./stations";
import submissionsRouter from "./routes/submissions";
import adminRouter from "./routes/admin";
import authRouter from "./routes/auth";
import analyticsRouter from "./routes/analytics";

const app = express();
const port = process.env.PORT || 8080;

// Core middleware
app.use(cors());
app.use(express.json());

// ---------- Static files ----------
// When running in dev (__dirname = src) this resolves to ../public
// When running built code (__dirname = dist) this also resolves to ../public
const publicDir = path.join(__dirname, "..", "public");

// Serve anything in /public
app.use(express.static(publicDir));

// Simple health check
app.get("/", (_req, res) => {
  res.send("Tarcart API is running.");
});

// Public gas prices page
app.get(["/gas.html", "/gas"], (_req, res) => {
  res.sendFile(path.join(publicDir, "gas.html"));
});

// Admin console page
app.get(["/admin.html", "/admin"], (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

// ---------- API routes ----------
app.use("/api/stations", stationsRouter);
app.use("/api/price-submissions", submissionsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

// ---------- Start server ----------
app.listen(port, () => {
  console.log(`Tarcart API listening on port ${port}`);
});
