import { Router } from "express";
import { pool } from "./db";
import { geocodeAddress } from "./services/geocoding";

const router = Router();

/**
 * GET /api/stations
 *
 * Returns all stations plus the latest *approved* prices per grade
 * for each station. Prices are exposed in a `prices_cents` object:
 *
 *   {
 *     id: 1,
 *     name: "Shields Bazaar Fuel Center",
 *     ...,
 *     prices_cents: {
 *       "87": 2870,
 *       "89": 2890,
 *       "93": 2930,
 *       "diesel": 2540
 *     }
 *   }
 *
 * These values are thousandths of a dollar, so the client displays:
 *   display = (price_cents / 1000).toFixed(3)
 */
router.get("/", async (req, res) => {
  console.log("🚦 HIT /api/stations — WITH PRICES + GEOCODING");

  try {
    // 1) Load all stations
    const { rows: stations } = await pool.query(
      `SELECT id, name, brand, address, city, state, latitude, longitude, is_home
       FROM stations
       ORDER BY id ASC`
    );

    // 2) Load latest approved prices per (station, grade) from price_submissions
    //    We use DISTINCT ON to get the most recently reviewed row for each pair.
    const { rows: priceRows } = await pool.query(
      `
      SELECT DISTINCT ON (station_id, grade)
             station_id,
             grade,
             price_cents
      FROM price_submissions
      WHERE status = 'approved'
        AND station_id IS NOT NULL
        AND grade IS NOT NULL
        AND price_cents IS NOT NULL
      ORDER BY station_id, grade, reviewed_at DESC NULLS LAST, created_at DESC
      `
    );

    // Build a lookup of { [stationId]: { [grade]: price_cents } }
    const pricesByStation: Record<number, Record<string, number>> = {};

    for (const row of priceRows) {
      const sid = row.station_id as number;
      if (!sid) continue;
      if (!pricesByStation[sid]) pricesByStation[sid] = {};
      if (!row.grade) continue;
      pricesByStation[sid][String(row.grade).toLowerCase()] = Number(
        row.price_cents
      );
    }

    // 3) Attach prices and lazily geocode any missing coordinates
    for (const station of stations as any[]) {
      const sid: number = station.id;

      // Attach prices_cents map (keys as "87", "89", "93", "diesel")
      const stationPrices = pricesByStation[sid] || {};
      const normalized: Record<string, number> = {};

      for (const [gradeRaw, value] of Object.entries(stationPrices)) {
        const g = gradeRaw.toLowerCase();
        if (g === "regular" || g === "87" || g === "unleaded") {
          normalized["87"] = value;
        } else if (g === "midgrade" || g === "89") {
          normalized["89"] = value;
        } else if (g === "premium" || g === "93" || g === "supreme") {
          normalized["93"] = value;
        } else if (g === "diesel" || g === "d") {
          normalized["diesel"] = value;
        } else {
          // keep as-is for any custom grade labels
          normalized[g] = value;
        }
      }

      (station as any).prices_cents = normalized;

      // If we don't have coordinates yet, try to geocode and cache them
      if (
        (station.latitude === null || station.latitude === undefined) &&
        (station.longitude === null || station.longitude === undefined) &&
        station.address &&
        station.city &&
        station.state
      ) {
        try {
          const formattedAddress = `${station.address}, ${station.city}, ${station.state}`;
          const geo = await geocodeAddress(formattedAddress);

          if (geo && typeof geo.lat === "number" && typeof geo.lng === "number") {
            station.latitude = geo.lat;
            station.longitude = geo.lng;

            // Persist coordinates so we don't have to geocode again next time
            await pool.query(
              `
              UPDATE stations
              SET latitude = $1,
                  longitude = $2
              WHERE id = $3
              `,
              [geo.lat, geo.lng, sid]
            );

            console.log(`✅ Geocoded ${station.name} -> ${geo.lat}, ${geo.lng}`);
          }
        } catch (err) {
          console.error(`❌ Geocoding failed for station ${station.name}`, err);
        }
      }
    }

    res.json(stations);
  } catch (err) {
    console.error("❌ Error in GET /api/stations", err);
    res.status(500).json({ error: "Failed to load stations" });
  }
});

export default router;
