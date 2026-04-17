// [Task 03 — Patient-Dentist Messaging · R2 R3]
// GET  /api/messaging — load (or lazily create) the patient's thread + messages
// POST /api/messaging — append a message and touch the thread's updatedAt
//
// R2: Both handlers persist data using the Prisma Thread and Message models,
//     keeping messages in a proper relational structure the clinic can query.
//
// R3: State Consistency — POST uses a $transaction to write the message AND
//     update thread.updatedAt in one round-trip, preventing a partial-write
//     state where a message exists but the thread's recency cursor is stale.
//
// Design note: a patient has at most one open thread in this model (simplified
// for the challenge). resolveThread finds or creates it transparently so the
// client never needs to manage thread creation separately.

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

// [R2: Backend Route — thread resolution]
// Looks up an existing thread by ID, falls back to the patient's most recent
// thread, or creates a new one. Keeps the client stateless: it can pass a
// threadId for efficiency but the server handles the missing-thread case.
async function resolveThread(threadId: string | undefined, patientId: string) {
  if (threadId) {
    const existing = await prisma.thread.findUnique({ where: { id: threadId } });
    if (existing) return existing;
  }
  const existing = await prisma.thread.findFirst({
    where: { patientId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.thread.create({ data: { patientId } });
}

export async function GET(req: Request) {
  // [R2: Backend Route — load thread + messages for the chat panel]
  const { searchParams } = new URL(req.url);
  const threadId  = searchParams.get("threadId");
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
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // [R2 R3: Backend Route + State Consistency]
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const content   = body.content?.trim();
  const sender    = body.sender ?? "patient";
  const patientId = body.patientId ?? DEMO_PATIENT_ID;

  // [R2: Backend Route — input validation before any DB write]
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: "content exceeds 2000 characters" }, { status: 400 });
  }
  if (!isValidSender(sender)) {
    return NextResponse.json({ error: "invalid sender" }, { status: 400 });
  }

  try {
    const thread = await resolveThread(body.threadId, patientId);

    // [R3: State Consistency — $transaction]
    // Message creation and thread.updatedAt bump happen atomically.
    // If either write fails the DB rolls back, leaving no orphaned message
    // with a stale thread cursor. The clinic inbox sorts by updatedAt so
    // this also keeps the recency order correct.
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { threadId: thread.id, content, sender },
      }),
      prisma.thread.update({
        where: { id: thread.id },
        data:  { updatedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ ok: true, thread, message }, { status: 201 });
  } catch (err) {
    console.error("[messaging] POST failed", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
