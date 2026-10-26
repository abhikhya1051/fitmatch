import { NextResponse } from "next/server";
import { explain } from "@/lib/ai";
import { BRANDS } from "@/lib/charts";
import { recommend, recommendAll, SizingError } from "@/lib/engine";
import { RecommendRequestSchema } from "@/lib/schema";

export async function POST(req: Request) {
  const body = RecommendRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Add at least one pair of jeans you own and pick a brand." }, { status: 400 });
  }

  try {
    const recommendation = recommend(body.data);
    const explanation = await explain(recommendation);
    const everywhere = recommendAll(
      body.data.knownFits,
      body.data.preference,
      BRANDS.map((b) => b.id),
    ).map((r) => ({
      brandId: r.targetBrandId,
      brandName: r.targetBrandName,
      size: r.size,
      alias: r.alias,
      level: r.confidence.level,
    }));

    return NextResponse.json({
      id: crypto.randomUUID(),
      recommendation,
      explanation: explanation.value,
      explanationVia: explanation.via,
      everywhere,
    });
  } catch (err) {
    if (err instanceof SizingError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
