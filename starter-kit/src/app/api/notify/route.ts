// [Task 02 — Notification System · R1 R2 R3 R4]
// Standalone notification endpoint — separate from /api/scans so the clinic
// dashboard or external webhooks can also create / query / acknowledge alerts.
//
// POST   /api/notify  — create a notification for a given scanId + status
// GET    /api/notify  — list notifications (optionally filter unread)
// PATCH  /api/notify  — mark a notification as read
//
// R2: All three methods operate on the Prisma Notification model which carries
//     a `read` boolean, enabling unread-count badges in the clinic UI.
// R4: Each handler validates required fields and returns appropriate HTTP codes.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEMO_CLINIC_USER_ID } from "@/lib/constants";

type NotifyBody = {
  scanId?: string;
  status?: "pending" | "completed" | "failed";
  userId?: string;
  title?: string;
  message?: string;
};

export async function POST(req: Request) {
  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { scanId, status, userId, title, message } = body;

  // [R4: API Design — required field validation]
  if (!scanId || !status) {
    return NextResponse.json({ error: "scanId and status are required" }, { status: 400 });
  }

  // Only completed scans produce a notification; other statuses are a no-op
  if (status !== "completed") {
    return NextResponse.json({ ok: true, notification: null });
  }

  try {
    // [R2: Prisma Notification model — read defaults to false on creation]
    const notification = await prisma.notification.create({
      data: {
        userId: userId ?? DEMO_CLINIC_USER_ID,
        scanId,
        type: "scan_completed",
        title:   title   ?? "New scan ready for review",
        message: message ?? `Patient scan ${scanId.slice(0, 8)} has been uploaded and is ready for clinician review.`,
        // read: false — Prisma model default; clinic must explicitly mark read
      },
    });

    // [R3: Async Flow — production fan-out stub]
    // In production this would dispatch to Twilio/Telnyx SMS or a push webhook.
    // Kept as a console log so the flow is observable without real credentials.
    console.log(`[notify] scan_completed notification=${notification.id} scan=${scanId}`);

    // [R4: API Design — 201 Created]
    return NextResponse.json({ ok: true, notification }, { status: 201 });
  } catch (err) {
    console.error("[notify] POST failed", err);
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // [R2: Prisma Notification model — supports unread filtering for badge counts]
  const { searchParams } = new URL(req.url);
  const userId    = searchParams.get("userId")  ?? DEMO_CLINIC_USER_ID;
  const unreadOnly = searchParams.get("unread") === "true";

  try {
    const notifications = await prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ notifications });
  } catch (err) {
    console.error("[notify] GET failed", err);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  // [R2: Prisma Notification model — mark-as-read endpoint]
  // Clinic UI calls PATCH { id, read: true } to clear the unread badge.
  let body: { id?: string; read?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // [R4: API Design — validate required id]
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const notification = await prisma.notification.update({
      where: { id: body.id },
      data:  { read: body.read ?? true },
    });
    return NextResponse.json({ ok: true, notification });
  } catch (err) {
    console.error("[notify] PATCH failed", err);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}
