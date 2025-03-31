import { db } from "@/drizzle/db";
import { UserTable } from "@/drizzle/schema";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

export async function POST(request: Request) {
    const data = await request.json();
    const { userId } = await auth();
    const { trades } = data;

    if (!userId) {
        return new Response(
            JSON.stringify({
                error: "Not authenticated",
            }),
            {
                status: 401,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

    const user = await db.query.UserTable.findFirst({
        where: eq(UserTable.id, userId),
    });

    if (user?.tokens === 0) {
        return new Response(
            JSON.stringify({
                error: "You don't have enough tokens for this operation.",
            }),
            {
                status: 402,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

    if (user && user.tokens !== null && user.tokens !== undefined) {
        const updatedTokens = user.tokens - 1;

        await db
            .update(UserTable)
            .set({ tokens: updatedTokens })
            .where(eq(UserTable.id, user.id))
            .execute();
    }

    try {
        const res = await anthropic.messages.create({
            model: "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            temperature: 1,
            system: 'Using the provided trade data, group each trade by its opening time in 3-hour intervals (e.g., 00:00–02:59, 03:00–05:59, 06:00–08:59, etc.). For each interval, analyze trading patterns and performance.\n\nBased on your analysis, return ONLY comments about the trading patterns and recommendations. Structure the response in JSON format with the following structure:\n\n{\n  "claudeComments": {\n    "generalObservations": [\n      // Array of observations about the trading patterns\n    ],\n    "recommendations": [\n      // Array of actionable recommendations based on the analysis\n    ]\n  }\n}\n\nIMPORTANT: You must return ONLY valid JSON with no markdown formatting, no backticks, no code block markers, and no additional text before or after the JSON object. The response should begin with { and end with } and contain nothing else.',
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(trades),
                        },
                    ],
                },
            ],
        });
        return new Response(JSON.stringify(res), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: unknown) {
        console.error("Error processing request:", error);

        let errorMessage = "An unknown error occurred";
        if (error instanceof Error) {
            errorMessage = error.message;
        }

        return new Response(
            JSON.stringify({
                error: errorMessage,
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}
