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
}

export function createGeocoder(db: Pool) {
  async function geocodeAddress(address: string) {
    const apiKey = process.env.GOOGLE_GEOCODE_KEY;
    if (!apiKey) {
      console.warn("GOOGLE_GEOCODE_KEY not set; skipping geocoding");
      return null;
    }

    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(address) +
      "&key=" +
      apiKey;

    const res = await fetch(url);
    if (!res.ok) {
      console.error("Geocode HTTP error", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) {
      console.warn("Geocode failed:", address, data.status, data.error_message);
      return null;
    }

    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }

  async function ensureStationCoords(station: StationRow): Promise<StationRow> {
    // station already has lat/lng → skip
    if (station.latitude != null && station.longitude != null) {
      return station;
    }

    // Build address string
    const parts = [
      station.address,
      station.city,
      station.state
    ].filter(Boolean);

    if (parts.length === 0) return station;

    const fullAddress = parts.join(", ");

    try {
      const coords = await geocodeAddress(fullAddress);
      if (!coords) return station;

      // Save the new coords back into Postgres
      await db.query(
        "UPDATE stations SET latitude = $1, longitude = $2 WHERE id = $3",
        [coords.lat, coords.lng, station.id]
      );

      return {
        ...station,
        latitude: coords.lat,
        longitude: coords.lng
      };

    } catch (err) {
      console.error("Error geocoding station", station.id, err);
      return station;
    }
  }

  return { ensureStationCoords };
}
