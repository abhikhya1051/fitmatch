import { NextResponse } from "next/server";
import { z } from "zod";
import { parseProfile } from "@/lib/ai";

const Body = z.object({ text: z.string().min(3).max(1000) });

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Tell us a bit about the jeans you own." }, { status: 400 });
  }
  const result = await parseProfile(body.data.text);
  return NextResponse.json({ ...result.value, via: result.via });
}
