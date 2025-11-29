import express from "express";
import cors from "cors";
import stationsRouter from "./stations";
import submissionsRouter from "./routes/submissions";
import adminRouter from "./routes/admin";
import authRouter from "./routes/auth";
import analyticsRouter from "./routes/analytics";

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use("/api/analytics", analyticsRouter);

// Health check endpoint (for testing)
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Public API routes
app.use("/api/stations", stationsRouter);
app.use("/api/price-submissions", submissionsRouter);

// Auth (login) routes
app.use("/api/auth", authRouter);

// Admin routes (protected by ADMIN_TOKEN via adminRouter)
app.use("/api/admin", adminRouter);

app.listen(port, () => {
  console.log(`Tarcart API listening on port ${port}`);
});
