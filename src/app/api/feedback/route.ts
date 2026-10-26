import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { calibrate, loadFeedback, saveFeedback } from "@/lib/feedback";

export async function POST(req: Request) {
  try {
    await saveFeedback(await req.json());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
    }
    // Read-only filesystems (e.g. serverless hosts) land here. See decision log D6.
    console.error("feedback write failed", err);
    return NextResponse.json({ ok: false, error: "Feedback storage unavailable" }, { status: 503 });
  }
}

export async function GET() {
  return NextResponse.json(calibrate(await loadFeedback()));
}
