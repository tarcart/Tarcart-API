import express from "express";
import path from "path";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------
// STATIC FILES (IMPORTANT)
// -------------------------------
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

console.log("📁 Serving static files from:", publicDir);

// -------------------------------
// DATABASE
// -------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// -------------------------------
// ROUTES
// -------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// GET /api/stations
app.get("/api/stations", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        brand,
        address,
        city,
        state,
        latitude,
        longitude,
        is_home
      FROM stations
      ORDER BY id;
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error loading stations:", err);
    res.status(500).json({ error: "Failed to load stations" });
  }
});

// -------------------------------
// GAS.HTML ROUTE
// -------------------------------
app.get("/gas", (req, res) => {
  res.sendFile(path.join(publicDir, "gas.html"));
});

// -------------------------------
// START SERVER
// -------------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Tarcart API listening on port ${PORT}`);
});
