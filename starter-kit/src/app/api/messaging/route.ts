import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEMO_PATIENT_ID } from "@/lib/constants";

type Sender = "patient" | "dentist";

type PostBody = {
  threadId?: string;
  patientId?: string;
  content?: string;
  sender?: Sender;
};

function isValidSender(v: unknown): v is Sender {
  return v === "patient" || v === "dentist";
}

async function resolveThread(threadId: string | undefined, patientId: string) {
  if (threadId) {
    const existing = await prisma.thread.findUnique({ where: { id: threadId } });
    if (existing) return existing;
  }

  // Fall back to (or create) the patient's single open thread — a patient
  // only needs one conversation with the clinic in this simplified model.
  const existing = await prisma.thread.findFirst({
    where: { patientId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;

  return prisma.thread.create({ data: { patientId } });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");
  const patientId = searchParams.get("patientId") ?? DEMO_PATIENT_ID;

  try {
    const thread = await resolveThread(threadId ?? undefined, patientId);
    const messages = await prisma.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ thread, messages });
  } catch (err) {
    console.error("[messaging] GET failed", err);
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const content = body.content?.trim();
  const sender = body.sender ?? "patient";
  const patientId = body.patientId ?? DEMO_PATIENT_ID;

  if (!content) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 },
    );
  }
  if (content.length > 2000) {
    return NextResponse.json(
      { error: "content exceeds 2000 characters" },
      { status: 400 },
    );
  }
  if (!isValidSender(sender)) {
    return NextResponse.json({ error: "invalid sender" }, { status: 400 });
  }

  try {
    const thread = await resolveThread(body.threadId, patientId);

    // Create the message and touch the thread's updatedAt in one round-trip
    // so the clinician inbox can order by recency.
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { threadId: thread.id, content, sender },
      }),
      prisma.thread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return NextResponse.json(
      { ok: true, thread, message },
      { status: 201 },
    );
  } catch (err) {
    console.error("[messaging] POST failed", err);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}
