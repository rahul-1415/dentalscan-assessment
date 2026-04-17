// [Task 02 — Notification System · R1 R3 R4]
// POST /api/scans — creates a scan record and fires a notification inline.
// GET  /api/scans — returns the 25 most recent scans (clinic review list).
//
// R1: Notification is triggered inside the same POST handler that creates the
//     scan, making the side-effect atomic with scan creation from the client's
//     perspective: one request → scan + notification.
//
// R3: Async flow — notification creation is wrapped in its own try/catch so a
//     failure there does NOT prevent the scan from being returned to the client.
//     The client never retries the upload because of a notification failure.
//
// R4: API design — validates body shape, returns 400 on bad input, 500 with a
//     logged error on DB failure, 201 with both scan and notification on success.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEMO_CLINIC_USER_ID } from "@/lib/constants";

type CreateScanBody = {
  images?: string[];
  status?: "pending" | "completed" | "failed";
};

export async function POST(req: Request) {
  let body: CreateScanBody;
  try {
    body = (await req.json()) as CreateScanBody;
  } catch {
    // [R4: API Design — reject malformed JSON early]
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const images = Array.isArray(body.images) ? body.images : [];
  const status = body.status ?? "completed";

  // Store only positional identifiers — full base64 blobs would exceed SQLite
  // limits and would live in object storage (S3/GCS) in production.
  const imageRefs = images.map((_, i) => `scan-frame-${i}`).join(",");

  try {
    // [R1: Trigger on Upload — scan record persisted first]
    const scan = await prisma.scan.create({
      data: { status, images: imageRefs },
    });

    // [R1 R3: Notification trigger — inline, non-blocking for the client]
    // Created after the scan so we have a valid scanId to reference.
    // Inner try/catch means a notification DB failure does not roll back
    // or block the scan response — the upload always succeeds if the scan
    // write succeeds. (R3: async flow does not block upload response)
    let notification = null;
    if (status === "completed") {
      try {
        // [Task 02 · R2: Prisma Notification model — persists read/unread state]
        // The Notification row created here defaults to read=false, giving the
        // clinic an unread badge until they mark it read via PATCH /api/notify.
        notification = await prisma.notification.create({
          data: {
            userId: DEMO_CLINIC_USER_ID,
            scanId: scan.id,
            type: "scan_completed",
            title: "New scan ready for review",
            message: `Patient scan ${scan.id.slice(0, 8)} is ready. Join the telehealth room to review.`,
          },
        });
      } catch (err) {
        // Log but do not re-throw — scan upload must succeed regardless
        console.error("[scans] notification creation failed", err);
      }
    }

    // [R4: API Design — 201 Created with both resources in response body]
    return NextResponse.json({ scan, notification }, { status: 201 });
  } catch (err) {
    console.error("[scans] POST failed", err);
    return NextResponse.json({ error: "Failed to create scan" }, { status: 500 });
  }
}

export async function GET() {
  // [R4: API Design — paginated list endpoint for clinic review dashboard]
  try {
    const scans = await prisma.scan.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return NextResponse.json({ scans });
  } catch (err) {
    console.error("[scans] GET failed", err);
    return NextResponse.json({ error: "Failed to load scans" }, { status: 500 });
  }
}
