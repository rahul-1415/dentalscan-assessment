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

  if (!scanId || !status) {
    return NextResponse.json(
      { error: "scanId and status are required" },
      { status: 400 },
    );
  }

  if (status !== "completed") {
    return NextResponse.json({ ok: true, notification: null });
  }

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: userId ?? DEMO_CLINIC_USER_ID,
        scanId,
        type: "scan_completed",
        title: title ?? "New scan ready for review",
        message:
          message ??
          `Patient scan ${scanId.slice(0, 8)} has been uploaded and is ready for clinician review.`,
      },
    });

    // In production this is where we'd fan out to Twilio/Telnyx/webhooks.
    // Keeping it as a log so the flow is observable without real credentials.
    console.log(
      `[notify] scan_completed notification=${notification.id} scan=${scanId}`,
    );

    return NextResponse.json({ ok: true, notification }, { status: 201 });
  } catch (err) {
    console.error("[notify] POST failed", err);
    return NextResponse.json(
      { error: "Failed to create notification" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? DEMO_CLINIC_USER_ID;
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
    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  let body: { id?: string; read?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const notification = await prisma.notification.update({
      where: { id: body.id },
      data: { read: body.read ?? true },
    });
    return NextResponse.json({ ok: true, notification });
  } catch (err) {
    console.error("[notify] PATCH failed", err);
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 },
    );
  }
}
