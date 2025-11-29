// src/services/geocoding.ts
import type { Pool } from "pg";

export interface StationRow {
  id: number;
  name: string;
  brand?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  prices_cents?: Record<string, number> | null;
  is_home?: boolean | null;
}

export function createGeocoder(db: Pool) {
  const apiKey = process.env.GOOGLE_GEOCODE_KEY;

  console.log("[GEOCODE] createGeocoder – apiKey present?", !!apiKey);

  async function geocodeAddress(address: string) {
    if (!apiKey) {
      console.warn("[GEOCODE] GOOGLE_GEOCODE_KEY not set; skipping geocoding");
      return null;
    }

    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(address) +
      "&key=" +
      apiKey;

    // Mask the key in logs
    const maskedUrl = url.replace(apiKey, "****");
    console.log("[GEOCODE] Request URL:", maskedUrl);

    try {
      const res = await fetch(url);
      console.log("[GEOCODE] HTTP status:", res.status);

      const data = await res.json();
      console.log(
        "[GEOCODE] API status:",
        data.status,
        data.error_message || ""
      );

      if (data.status !== "OK" || !data.results?.length) {
        console.warn(
          "[GEOCODE] No results for address:",
          address,
          "status:",
          data.status
        );
        return null;
      }

      const loc = data.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    } catch (err) {
      console.error("[GEOCODE] Exception during fetch:", err);
      return null;
    }
  }

  async function ensureStationCoords(station: StationRow): Promise<StationRow> {
    console.log(
      "[GEOCODE] ensureStationCoords – station:",
      station.id,
      station.name,
      "lat:",
      station.latitude,
      "lng:",
      station.longitude
    );

    // Already has coords
    if (station.latitude != null && station.longitude != null) {
      console.log("[GEOCODE] Station already has coords, skipping:", station.id);
      return station;
    }

    const parts = [station.address, station.city, station.state].filter(Boolean);
    if (parts.length === 0) {
      console.warn(
        "[GEOCODE] Station has no address parts, skipping:",
        station.id
      );
      return station;
    }

    const fullAddress = parts.join(", ");
    console.log("[GEOCODE] Full address for station", station.id, ":", fullAddress);

    const coords = await geocodeAddress(fullAddress);
    if (!coords) {
      console.warn(
        "[GEOCODE] Geocoding returned no coords for station",
        station.id
      );
      return station;
    }

    console.log(
      "[GEOCODE] Got coords for station",
      station.id,
      ":",
      coords.lat,
      coords.lng
    );

    try {
      await db.query(
        "UPDATE stations SET latitude = $1, longitude = $2 WHERE id = $3",
        [coords.lat, coords.lng, station.id]
      );
      console.log("[GEOCODE] Saved coords to DB for station", station.id);
    } catch (err) {
      console.error("[GEOCODE] Failed to update DB for station", station.id, err);
    }

    return {
      ...station,
      latitude: coords.lat,
      longitude: coords.lng,
    };
  }

  return { ensureStationCoords };
}
