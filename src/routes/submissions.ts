import { Router } from "express";
import { pool } from "../db";

const router = Router();

/**
 * Normalize incoming payload from different client versions into a uniform
 * structure that our DB expects.
 *
 * Supported shapes:
 *
 * 1) Legacy single-grade body:
 *    {
 *      stationId,
 *      stationName,
 *      stationAddress,
 *      grade,
 *      price,            // e.g. 4.499  (dollars per gallon)
 *      notes,
 *      submitterName
 *    }
 *
 * 2) New multi-grade body from gas.html:
 *    {
 *      station_id,
 *      submissions: [
 *        { grade: "87", price_cents: 4499 },
 *        { grade: "89", price: 4.799 }
 *      ],
 *      submitter_name,
 *      notes,
 *      station_name?,        // optional override
 *      station_address?      // optional override
 *    }
 *
 * We store price as thousandths of a dollar ("mills"):
 *   4.499  ->  4499
 */

interface NormalisedSubmissionRow {
  stationId: number | null;
  stationName: string | null;
  stationAddress: string | null;
  grade: string;
  priceMills: number;
  notes: string | null;
  submitterName: string | null;
}

function normaliseBody(req: any): NormalisedSubmissionRow[] {
  const body = req.body || {};

  const stationIdRaw = body.station_id ?? body.stationId;
  const stationId =
    typeof stationIdRaw === "number"
      ? stationIdRaw
      : typeof stationIdRaw === "string" && stationIdRaw.trim() !== ""
      ? Number(stationIdRaw)
      : null;

  const stationName = (body.station_name ?? body.stationName ?? "").trim() || null;
  const stationAddress =
    (body.station_address ?? body.stationAddress ?? "").trim() || null;

  const notes = (body.notes ?? "").toString().trim() || null;
  const submitterName =
    (body.submitter_name ?? body.submitterName ?? "").toString().trim() || null;

  const rows: NormalisedSubmissionRow[] = [];

  // Preferred shape: submissions[]
  if (Array.isArray(body.submissions) && body.submissions.length > 0) {
    for (const sub of body.submissions) {
      if (!sub) continue;

      const grade = (sub.grade ?? body.grade ?? "").toString().trim();
      if (!grade) continue;

      let priceMills: number | null = null;

      if (typeof sub.price_cents === "number") {
        // already in thousandths of a dollar, e.g. 4499 => $4.499
        priceMills = sub.price_cents;
      } else if (typeof sub.price === "number") {
        // convert 4.499 => 4499
        priceMills = Math.round(sub.price * 1000);
      }

      if (priceMills == null || !Number.isFinite(priceMills)) {
        continue;
      }

      rows.push({
        stationId,
        stationName,
        stationAddress,
        grade,
        priceMills,
        notes,
        submitterName,
      });
    }

    return rows;
  }

  // Legacy single-grade body
  const legacyGrade = (body.grade ?? "").toString().trim();
  const legacyPriceCents =
    typeof body.price_cents === "number" ? body.price_cents : null;
  const legacyPrice =
    typeof body.price === "number" ? body.price : null;

  let legacyMills: number | null = null;
  if (legacyPriceCents != null) {
    legacyMills = legacyPriceCents;
  } else if (legacyPrice != null) {
    legacyMills = Math.round(legacyPrice * 1000);
  }

  if (legacyGrade && legacyMills != null && Number.isFinite(legacyMills)) {
    rows.push({
      stationId,
      stationName,
      stationAddress,
      grade: legacyGrade,
      priceMills: legacyMills,
      notes,
      submitterName,
    });
  }

  return rows;
}

// POST /api/price-submissions
// Public endpoint for community price updates
router.post("/", async (req, res) => {
  try {
    const rows = normaliseBody(req);

    if (!rows.length) {
      return res.status(400).json({
        error:
          "No valid grade/price submissions found. Provide either { grade, price } or submissions[{ grade, price_cents|price }].",
      });
    }

    const insertText = `
      INSERT INTO price_submissions (
        station_id,
        station_name,
        station_address,
        grade,
        price_cents,
        notes,
        submitter_name,
        submitter_ip
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id;
    `;

    const ids: number[] = [];

    for (const row of rows) {
      const result = await pool.query(insertText, [
        row.stationId ?? null,
        row.stationName,
        row.stationAddress,
        row.grade,
        row.priceMills,
        row.notes,
        row.submitterName,
        req.ip,
      ]);

      ids.push(result.rows[0].id);
    }

    // If only one row, keep old shape for compatibility
    if (ids.length === 1) {
      return res.status(201).json({ id: ids[0] });
    }

    return res.status(201).json({ ids });
  } catch (err) {
    console.error("Error in POST /api/price-submissions", err);
    res.status(500).json({ error: "Failed to submit price" });
  }
});

/**
 * POST /api/price-submissions/new-station
 *
 * Used when a user suggests a brand new station that is not yet in the
 * stations table. We record it as a price_submissions row with no station_id
 * so the admin approval flow can later create the real station.
 */
router.post("/new-station", async (req, res) => {
  try {
    const {
      name,
      brand,
      address,
      city,
      state,
      postal_code,
      notes,
      source,
      submitter_name,
      submitterName,
    } = req.body || {};

    const stationName = (name ?? "").toString().trim();
    if (!stationName) {
      return res.status(400).json({ error: "Station name is required." });
    }

    const parts = [
      (address ?? "").toString().trim() || null,
      (city ?? "").toString().trim() || null,
      (state ?? "").toString().trim() || null,
      (postal_code ?? "").toString().trim() || null,
    ].filter(Boolean);

    const stationAddress = parts.join(", ") || null;

    let combinedNotes = (notes ?? "").toString().trim();
    if (brand) {
      const brandPart = `Brand: ${brand}`;
      combinedNotes = combinedNotes
        ? `${combinedNotes} | ${brandPart}`
        : brandPart;
    }
    if (source) {
      const sourcePart = `Source: ${source}`;
      combinedNotes = combinedNotes
        ? `${combinedNotes} | ${sourcePart}`
        : sourcePart;
    }

    const finalSubmitterName =
      (submitter_name ?? submitterName ?? "").toString().trim() || null;

    const result = await pool.query(
      `
      INSERT INTO price_submissions (
        station_id,
        station_name,
        station_address,
        grade,
        price_cents,
        notes,
        submitter_name,
        submitter_ip
      )
      VALUES (NULL, $1, $2, NULL, NULL, $3, $4, $5)
      RETURNING id;
      `,
      [stationName, stationAddress, combinedNotes || null, finalSubmitterName, req.ip]
    );

    return res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    console.error("Error in POST /api/price-submissions/new-station", err);
    res.status(500).json({ error: "Failed to submit station suggestion" });
  }
});

export default router;
