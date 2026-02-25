import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet
} from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────

type ReviewEntry = {
  id: string;
  timestamp: string;
  language: string;
  framework?: string;
  score: number;
  issueCount: number;
  criticalCount: number;
  summary: string;
};

type AntiPattern = {
  pattern: string;
  category: string;
  frequency: number;
  firstSeen: string;
};

// ── System prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert AI code reviewer and pair programmer with deep knowledge of security, performance, and software engineering best practices across all major languages.

When the user shares code for review, use the analyzeCode tool to record a structured analysis, then follow up with a detailed explanation. Reference exact variable and function names, and mention line numbers when relevant. Always note what was done well, not just issues.

When you notice a recurring problem across multiple reviews, use rememberPattern to track it.

Severity levels for issues:
- critical: security holes, crashes, data corruption
- warning: logic errors, performance problems, bad practices
- info: style and minor improvements
- good: patterns worth reinforcing

Today: ${new Date().toISOString().split("T")[0]}`;

// ── Durable Object ─────────────────────────────────────────────────────

export class CodeReviewAgent extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    // Load saved patterns to personalise the system prompt
    const savedPatterns =
      (await this.ctx.storage.get<AntiPattern[]>("antiPatterns")) ?? [];
    const patternContext =
      savedPatterns.length > 0
        ? `\n\nKnown recurring patterns for this developer:\n${savedPatterns
            .map((p, i) => `${i + 1}. [${p.category}] ${p.pattern} (seen ${p.frequency}x)`)
            .join("\n")}`
        : "";

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: SYSTEM_PROMPT + patternContext,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // ── Tool 1: Structured code analysis ──────────────────────────
        analyzeCode: tool({
          description:
            "Perform a structured code analysis. Call this immediately whenever the user pastes code for review. Populate ALL fields with your analysis.",
          inputSchema: z.object({
            language: z.string().describe("Programming language (e.g. TypeScript, Python, Go)"),
            framework: z
              .string()
              .optional()
              .describe("Framework if identifiable (e.g. React, FastAPI, Express)"),
            linesOfCode: z.number().int().describe("Approximate line count"),
            issues: z.array(
              z.object({
                severity: z.enum(["critical", "warning", "info", "good"]),
                category: z.enum([
                  "bug",
                  "security",
                  "performance",
                  "style",
                  "maintainability"
                ]),
                line: z
                  .string()
                  .optional()
                  .describe("Line number or range, e.g. '15' or '10-20'"),
                title: z.string().describe("Short issue title"),
                description: z.string().describe("What the issue is and why it matters"),
                suggestion: z.string().describe("Concrete fix or improvement")
              })
            ),
            overallScore: z
              .number()
              .min(0)
              .max(10)
              .describe("Code quality score: 0=unusable, 5=average, 10=production-ready"),
            summary: z
              .string()
              .describe("2-3 sentence executive summary of the code quality")
          }),
          execute: async (analysis) => {
            const history =
              (await this.ctx.storage.get<ReviewEntry[]>("reviewHistory")) ?? [];

            const entry: ReviewEntry = {
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              language: analysis.language,
              framework: analysis.framework,
              score: analysis.overallScore,
              issueCount: analysis.issues.filter((i) => i.severity !== "good").length,
              criticalCount: analysis.issues.filter((i) => i.severity === "critical").length,
              summary: analysis.summary
            };

            history.push(entry);
            if (history.length > 100) history.shift();
            await this.ctx.storage.put("reviewHistory", history);

            return { ...analysis, reviewId: entry.id };
          }
        }),

        // ── Tool 2: Save recurring anti-pattern ───────────────────────
        rememberPattern: tool({
          description:
            "Save a recurring coding anti-pattern or bad habit for this developer so future reviews are personalised. Call when you notice something they do repeatedly.",
          inputSchema: z.object({
            pattern: z
              .string()
              .describe(
                "Short, actionable description, e.g. 'Forgets to handle Promise rejections'"
              ),
            category: z.enum([
              "bug",
              "security",
              "performance",
              "style",
              "maintainability"
            ])
          }),
          execute: async ({ pattern, category }) => {
            const patterns =
              (await this.ctx.storage.get<AntiPattern[]>("antiPatterns")) ?? [];

            const existing = patterns.find((p) => p.pattern === pattern);
            if (existing) {
              existing.frequency += 1;
            } else {
              patterns.push({
                pattern,
                category,
                frequency: 1,
                firstSeen: new Date().toISOString()
              });
            }

            // Keep top 20 by frequency
            patterns.sort((a, b) => b.frequency - a.frequency);
            if (patterns.length > 20) patterns.pop();
            await this.ctx.storage.put("antiPatterns", patterns);

            return {
              saved: true,
              pattern,
              category,
              frequency: existing ? existing.frequency : 1
            };
          }
        }),

        // ── Tool 3: Retrieve saved patterns ───────────────────────────
        getMyPatterns: tool({
          description:
            "Retrieve all saved anti-patterns and a summary of this developer's recurring issues.",
          inputSchema: z.object({}),
          execute: async () => {
            const patterns =
              (await this.ctx.storage.get<AntiPattern[]>("antiPatterns")) ?? [];
            const history =
              (await this.ctx.storage.get<ReviewEntry[]>("reviewHistory")) ?? [];

            const avgScore =
              history.length > 0
                ? history.reduce((s, r) => s + r.score, 0) / history.length
                : null;

            return {
              patterns,
              totalPatterns: patterns.length,
              totalReviews: history.length,
              averageScore: avgScore !== null ? Math.round(avgScore * 10) / 10 : null
            };
          }
        }),

        // ── Tool 4: Review statistics & trends ────────────────────────
        getReviewStats: tool({
          description:
            "Show detailed statistics about past code reviews: total reviews, average score, trends, and language breakdown.",
          inputSchema: z.object({}),
          execute: async () => {
            const history =
              (await this.ctx.storage.get<ReviewEntry[]>("reviewHistory")) ?? [];

            if (history.length === 0) {
              return { message: "No reviews yet. Paste some code to get started!" };
            }

            const scores = history.map((r) => r.score);
            const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
            const recentScores = scores.slice(-5);
            const recentAvg = recentScores.reduce((s, x) => s + x, 0) / recentScores.length;

            const trend =
              history.length >= 5
                ? recentAvg > avg + 0.3
                  ? "improving"
                  : recentAvg < avg - 0.3
                    ? "declining"
                    : "stable"
                : "not enough data";

            const langCounts: Record<string, { count: number; totalScore: number }> = {};
            history.forEach((r) => {
              if (!langCounts[r.language]) langCounts[r.language] = { count: 0, totalScore: 0 };
              langCounts[r.language].count += 1;
              langCounts[r.language].totalScore += r.score;
            });

            const languageBreakdown = Object.entries(langCounts)
              .map(([lang, { count, totalScore }]) => ({
                language: lang,
                reviews: count,
                avgScore: Math.round((totalScore / count) * 10) / 10
              }))
              .sort((a, b) => b.reviews - a.reviews);

            return {
              totalReviews: history.length,
              averageScore: Math.round(avg * 10) / 10,
              highestScore: Math.max(...scores),
              lowestScore: Math.min(...scores),
              recentAverage: Math.round(recentAvg * 10) / 10,
              trend,
              totalCriticalIssues: history.reduce((s, r) => s + r.criticalCount, 0),
              languageBreakdown,
              recentReviews: history
                .slice(-5)
                .reverse()
                .map((r) => ({
                  date: new Date(r.timestamp).toLocaleDateString(),
                  language: r.language,
                  score: r.score,
                  issues: r.issueCount,
                  critical: r.criticalCount
                }))
            };
          }
        })
      },
      onFinish,
      stopWhen: stepCountIs(8),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

// ── Worker entry ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
