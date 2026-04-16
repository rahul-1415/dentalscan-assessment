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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const images = Array.isArray(body.images) ? body.images : [];
  const status = body.status ?? "completed";

  // Store only image identifiers in DB to keep SQLite happy — full blobs
  // would live in object storage in production.
  const imageRefs = images.map((_, i) => `scan-frame-${i}`).join(",");

  try {
    const scan = await prisma.scan.create({
      data: { status, images: imageRefs },
    });

    // Trigger notification inline so the side-effect is atomic with scan
    // creation. If this throws we still return the scan so the client
    // doesn't retry the upload; the notification can be retried separately.
    let notification = null;
    if (status === "completed") {
      try {
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
        console.error("[scans] notification creation failed", err);
      }
    }

    return NextResponse.json({ scan, notification }, { status: 201 });
  } catch (err) {
    console.error("[scans] POST failed", err);
    return NextResponse.json(
      { error: "Failed to create scan" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const scans = await prisma.scan.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return NextResponse.json({ scans });
  } catch (err) {
    console.error("[scans] GET failed", err);
    return NextResponse.json(
      { error: "Failed to load scans" },
      { status: 500 },
    );
  }
}
