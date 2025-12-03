import { Router, Request, Response, NextFunction } from "express";
import { pool } from "../db";

const router = Router();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// Simple token-based guard for now.
// Later we'll replace this with a proper login system.
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN is not set");
    return res.status(500).json({ error: "Admin not configured" });
  }

  const headerToken =
    req.header("x-admin-token") ||
    (req.header("authorization") || "").replace(/^Bearer\s+/i, "");

  if (!headerToken || headerToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

router.use(requireAdmin);

// GET /api/admin/submissions?status=pending&limit=50
router.get("/submissions", async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || "pending";
    const limit = Math.min(
      parseInt((req.query.limit as string) || "50", 10),
      200
    );

    const result = await pool.query(
      `
      SELECT
        ps.id,
        ps.station_id,
        COALESCE(s.name, ps.station_name) AS station_name,
        COALESCE(s.address, ps.station_address) AS station_address,
        s.city,
        s.state,
        ps.grade,
        ps.price_cents,
        ps.notes,
        ps.submitter_name,
        ps.status,
        ps.created_at
      FROM price_submissions ps
      LEFT JOIN stations s ON s.id = ps.station_id
      WHERE ps.status = $1
      ORDER BY ps.created_at DESC
      LIMIT $2
      `,
      [status, limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error in GET /api/admin/submissions", err);
    res.status(500).json({ error: "Failed to load submissions" });
  }
});

// Approve a submission
// - If it has station_id + grade + price_cents => approve price & write station_prices
// - If it has NO station_id but has station_name => create a new station
// POST /api/admin/submissions/:id/approve
router.post(
  "/submissions/:id/approve",
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid submission id" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const submissionResult = await client.query(
        `
        SELECT *
        FROM price_submissions
        WHERE id = $1
        FOR UPDATE
        `,
        [id]
      );

      if (submissionResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Submission not found" });
      }

      const sub = submissionResult.rows[0];

      // CASE 1: price update for an existing station
      if (sub.station_id && sub.grade && sub.price_cents) {
        await client.query(
          `
          INSERT INTO station_prices (
            station_id,
            grade,
            price_cents,
            is_cash_price,
            source,
            source_note
          )
          VALUES ($1, $2, $3, FALSE, $4, $5)
          `,
          [
            sub.station_id,
            sub.grade,
            sub.price_cents,
            "admin-approval",
            sub.notes || null,
          ]
        );

        await client.query(
          `
          UPDATE price_submissions
          SET status = 'approved',
              reviewed_at = now()
          WHERE id = $1
          `,
          [id]
        );

        await client.query("COMMIT");
        return res.json({ ok: true, type: "price" });
      }

            // CASE 2: new station submission (no station_id yet, has station_name)
      if (!sub.station_id && sub.station_name) {
        // station_address was built as:
        //   "street, city, state, zip"
        const fullAddress: string = sub.station_address || "";

        let address: string | null = fullAddress || null;
        let city: string | null = null;
        let state: string | null = null;

        if (fullAddress) {
          const parts = fullAddress
            .split(",")
            .map((p: string) => p.trim())
            .filter(Boolean);

          if (parts.length >= 1) address = parts[0];
          if (parts.length >= 2) city = parts[1] || null;

          if (parts.length >= 3) {
            const stateToken = parts[2]
              .split(" ")
              .map((p: string) => p.trim())
              .filter(Boolean)[0];
            state = stateToken || null;
          }
        }

        const insertStationResult = await client.query(
          `
          INSERT INTO stations (
            name,
            brand,
            address,
            city,
            state,
            is_home
          )
          VALUES ($1, NULL, $2, $3, $4, FALSE)
          RETURNING id
          `,
          [sub.station_name, address || null, city, state]
        );

        const newStationId = insertStationResult.rows[0].id;

        await client.query(
          `
          UPDATE price_submissions
          SET station_id = $2,
              status = 'approved',
              reviewed_at = now()
          WHERE id = $1
          `,
          [id, newStationId]
        );

        await client.query("COMMIT");
        return res.json({ ok: true, type: "station", stationId: newStationId });
      }

      // CASE 3: unsupported submission shape
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Submission missing required fields. For prices: station_id, grade, price_cents. For new stations: station_name.",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error in POST /api/admin/submissions/:id/approve", err);
      res.status(500).json({ error: "Failed to approve submission" });
    } finally {
      client.release();
    }
  }
);

// Reject a submission
// POST /api/admin/submissions/:id/reject
router.post(
  "/submissions/:id/reject",
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid submission id" });
    }

    try {
      const result = await pool.query(
        `
        UPDATE price_submissions
        SET status = 'rejected',
            reviewed_at = now()
        WHERE id = $1
        `,
        [id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Submission not found" });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error in POST /api/admin/submissions/:id/reject", err);
      res.status(500).json({ error: "Failed to reject submission" });
    }
  }
);
// ===========================================================
// APPROVE / REJECT SUBMISSIONS
// ===========================================================
router.post("/api/admin/submissions/:id/:action", requireAdmin, async (req, res) => {
  const { id, action } = req.params;

  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ error: "Unknown action" });
  }

  // Load the submission row
  const { rows } = await pool.query(
    `
    SELECT *
    FROM price_submissions
    WHERE id = $1
    `,
    [id]
  );

  const submission = rows[0];
  if (!submission) {
    return res.status(404).json({ error: "Submission not found" });
  }

  // Handle REJECT
  if (action === "reject") {
    await pool.query(
      `
      UPDATE price_submissions
      SET status = 'rejected'
      WHERE id = $1
      `,
      [id]
    );
    return res.json({ ok: true });
  }

  // Handle APPROVE
  // -------------------------------------------------
  // If this is a NEW station suggestion (no station_id yet)
  if (!submission.station_id) {
    const stationName = submission.station_name;
    const fullAddress = submission.station_address || "";

    // Attempt to parse address "123 Main St, City, FL 33162"
    let address = fullAddress;
    let city = null;
    let state = null;

    const parts = fullAddress.split(",");
    if (parts.length >= 2) {
      address = parts[0].trim();
      city = parts[1].trim() || null;
      if (parts.length >= 3) {
        state = parts[2].trim().split(" ")[0] || null;
      }
    }

    // Insert new station
    const insertRes = await pool.query(
      `
      INSERT INTO stations (
        name,
        brand,
        address,
        city,
        state,
        is_home
      )
      VALUES ($1, NULL, $2, $3, $4, false)
      RETURNING id;
      `,
      [stationName, address || null, city, state]
    );

    const newStationId = insertRes.rows[0].id;

    // Link submission to new station + mark approved
    await pool.query(
      `
      UPDATE price_submissions
      SET station_id = $1,
          status = 'approved'
      WHERE id = $2
      `,
      [newStationId, id]
    );

    return res.json({ ok: true, station_id: newStationId });
  }

  // Existing station → just approve submission
  await pool.query(
    `
    UPDATE price_submissions
    SET status = 'approved'
    WHERE id = $1
    `,
    [id]
  );

  return res.json({ ok: true });
});

export default router;
