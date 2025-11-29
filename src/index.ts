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

// Serve static files (gas.html, admin.html, etc.)
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Health check endpoint (for testing / uptime checks)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public API routes
app.use("/api/stations", stationsRouter);
app.use("/api/price-submissions", submissionsRouter);

// Analytics routes
app.use("/api/analytics", analyticsRouter);

// Auth (login) routes
app.use("/api/auth", authRouter);

// Admin routes (protected by ADMIN_TOKEN via adminRouter)
app.use("/api/admin", adminRouter);

app.listen(port, () => {
  console.log(`Tarcart API listening on port ${port}`);
});
