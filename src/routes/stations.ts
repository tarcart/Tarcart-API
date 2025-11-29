// src/routes/stations.ts
import { Router } from "express";
import pool from "../db";
import { createGeocoder, StationRow } from "../services/geocoding";

const router = Router();
const { ensureStationCoords } = createGeocoder(pool);

// Haversine distance in miles
function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// GET /api/stations
// Returns active stations + latest prices + distance from home (if possible)
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query<StationRow>(
      `
      SELECT
        id,
        name,
        brand,
        address,
        city,
        state,
        latitude,
        longitude,
        prices_cents,
        is_home
      FROM stations
      ORDER BY is_home DESC, name ASC
      `
    );

    const withCoords = await Promise.all(
      rows.map((row) => ensureStationCoords(row))
    );
    res.json(withCoords);
  } catch (err) {
    console.error("Error in GET /api/stations", err);
    res.status(500).json({ error: "Failed to load stations" });
  }
});




export default router;
