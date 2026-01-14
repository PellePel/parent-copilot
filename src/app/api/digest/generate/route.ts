import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, brainDumps, children, digests } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function calculateAge(birthDate: string): { years: number; months: number } {
  const birth = new Date(birthDate);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();

  if (months < 0) {
    years--;
    months += 12;
  }

  return { years, months };
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "copilot") {
      return NextResponse.json(
        { error: "Only copilot users can access digests" },
        { status: 403 }
      );
    }

    const today = getTodayDateString();

    // Check for cached digest
    const cachedDigest = await db
      .select()
      .from(digests)
      .where(and(eq(digests.userId, session.user.id), eq(digests.date, today)))
      .get();

    if (cachedDigest) {
      return NextResponse.json({
        cached: true,
        digest: {
          recentMentions: JSON.parse(cachedDigest.recentMentions),
          considerThisWeek: JSON.parse(cachedDigest.considerThisWeek),
          comingUpSoon: JSON.parse(cachedDigest.comingUpSoon),
        },
      });
    }

    // Get user and partner info
    const copilotUser = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .get();

    if (!copilotUser?.partnerId) {
      return NextResponse.json({
        cached: false,
        digest: {
          recentMentions: [],
          considerThisWeek: [],
          comingUpSoon: [],
        },
        message: "No partner linked yet",
      });
    }

    // Get partner's recent brain dumps (last 7 days for more context)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentDumps = await db
      .select()
      .from(brainDumps)
      .where(eq(brainDumps.userId, copilotUser.partnerId))
      .orderBy(desc(brainDumps.createdAt))
      .limit(20);

    // Get children info for age-based suggestions
    const familyChildren = await db
      .select()
      .from(children)
      .where(eq(children.userId, copilotUser.partnerId));

    if (recentDumps.length === 0) {
      // No brain dumps yet, return empty digest
      const emptyDigest = {
        recentMentions: [],
        considerThisWeek: [],
        comingUpSoon: [],
      };

      await db.insert(digests).values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        date: today,
        recentMentions: JSON.stringify(emptyDigest.recentMentions),
        considerThisWeek: JSON.stringify(emptyDigest.considerThisWeek),
        comingUpSoon: JSON.stringify(emptyDigest.comingUpSoon),
      });

      return NextResponse.json({
        cached: false,
        digest: emptyDigest,
        message: "No brain dumps from partner yet",
      });
    }

    // Format brain dumps for the prompt
    const formattedDumps = recentDumps
      .map((d) => {
        const date = d.createdAt
          ? new Date(d.createdAt).toLocaleDateString()
          : "Unknown date";
        return `[${date}] ${d.content}`;
      })
      .join("\n\n");

    // Format children info
    const childrenInfo = familyChildren
      .map((c) => {
        const age = calculateAge(c.birthDate);
        const sexLabel = c.sex === "male" ? "boy" : c.sex === "female" ? "girl" : "";
        const ageStr = `${age.years} years${age.months > 0 ? `, ${age.months} months` : ""} old`;
        return `${c.name}: ${ageStr}${sexLabel ? ` (${sexLabel})` : ""}`;
      })
      .join("\n");

    // Call Claude to generate the digest
    const systemPrompt = `You are a helpful assistant for a co-parenting app called Copilot. Your job is to analyze thoughts and concerns shared by one parent (the "primary planner") and help their partner (the "copilot") understand what's on their mind and what they might want to discuss.

Your goal is to help the copilot parent:
1. Understand what their partner has been thinking about
2. Identify topics that might be good to bring up in conversation
3. Anticipate upcoming needs or decisions

Be warm, conversational, and practical. Focus on being helpful rather than comprehensive.`;

    const userPrompt = `Here are the recent thoughts shared by the primary planner:

${formattedDumps}

${childrenInfo ? `Children in the family:\n${childrenInfo}` : "No children information available yet."}

Based on these thoughts, please generate a digest with three sections:

1. **considerThisWeek**: 2-4 topics from the brain dumps that would be good to discuss this week. For each, provide:
   - topic: A short title (3-6 words)
   - summary: A brief explanation of what the partner mentioned (1-2 sentences)
   - conversationStarter: A natural way to bring this up (a question or comment)

2. **comingUpSoon**: 1-3 items that seem time-sensitive or have upcoming deadlines. For each, provide:
   - topic: A short title
   - urgency: "this_week" or "soon" (within 2 weeks)
   - context: Why this needs attention soon

If there's nothing time-sensitive, return an empty array for comingUpSoon.

Return your response as JSON only, with this exact structure:
{
  "considerThisWeek": [...],
  "comingUpSoon": [...]
}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    });

    // Parse the response
    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";

    let aiDigest;
    try {
      // Extract JSON from the response (handle potential markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiDigest = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch {
      console.error("Failed to parse AI response:", responseText);
      aiDigest = {
        considerThisWeek: [],
        comingUpSoon: [],
      };
    }

    // Format recent mentions from actual brain dumps (last 3 days)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const recentMentions = recentDumps
      .filter((d) => d.createdAt && new Date(d.createdAt) >= threeDaysAgo)
      .slice(0, 5)
      .map((d) => ({
        content: d.content,
        date: d.createdAt ? new Date(d.createdAt).toLocaleDateString() : null,
      }));

    const finalDigest = {
      recentMentions,
      considerThisWeek: aiDigest.considerThisWeek || [],
      comingUpSoon: aiDigest.comingUpSoon || [],
    };

    // Cache the digest
    await db.insert(digests).values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      date: today,
      recentMentions: JSON.stringify(finalDigest.recentMentions),
      considerThisWeek: JSON.stringify(finalDigest.considerThisWeek),
      comingUpSoon: JSON.stringify(finalDigest.comingUpSoon),
    });

    return NextResponse.json({
      cached: false,
      digest: finalDigest,
    });
  } catch (error) {
    console.error("Digest generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate digest" },
      { status: 500 }
    );
  }
}
