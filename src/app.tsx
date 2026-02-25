import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import {
  Button,
  Badge,
  InputArea,
  Empty,
  Surface,
  Text
} from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { Switch } from "@cloudflare/kumo";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  GearIcon,
  MoonIcon,
  SunIcon,
  CheckCircleIcon,
  XCircleIcon,
  BrainIcon,
  CaretDownIcon,
  BugIcon,
  CircleIcon,
  ShieldWarningIcon,
  LightningIcon,
  PaintBrushIcon,
  TreeStructureIcon,
  InfoIcon,
  StarIcon,
  ChartBarIcon,
  BookmarkSimpleIcon,
  CodeIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon
} from "@phosphor-icons/react";

// ── Types ────────────────────────────────────────────────────────────────

type IssueSeverity = "critical" | "warning" | "info" | "good";
type IssueCategory = "bug" | "security" | "performance" | "style" | "maintainability";

type CodeIssue = {
  severity: IssueSeverity;
  category: IssueCategory;
  line?: string;
  title: string;
  description: string;
  suggestion: string;
};

type AnalyzeCodeOutput = {
  language: string;
  framework?: string;
  linesOfCode: number;
  issues: CodeIssue[];
  overallScore: number;
  summary: string;
  reviewId: string;
};

type PatternEntry = {
  pattern: string;
  category: string;
  frequency: number;
  firstSeen: string;
};

type PatternsOutput = {
  patterns: PatternEntry[];
  totalPatterns: number;
  totalReviews: number;
  averageScore: number | null;
};

type StatsOutput = {
  message?: string;
  totalReviews?: number;
  averageScore?: number;
  highestScore?: number;
  lowestScore?: number;
  recentAverage?: number;
  trend?: string;
  totalCriticalIssues?: number;
  languageBreakdown?: Array<{ language: string; reviews: number; avgScore: number }>;
  recentReviews?: Array<{
    date: string;
    language: string;
    score: number;
    issues: number;
    critical: number;
  }>;
};

// ── Small helpers ─────────────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );
  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);
  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 8
      ? "bg-emerald-500"
      : score >= 6
        ? "bg-yellow-400"
        : score >= 4
          ? "bg-orange-400"
          : "bg-red-500";
  const label =
    score >= 8 ? "Excellent" : score >= 6 ? "Good" : score >= 4 ? "Fair" : "Needs work";
  const textColor =
    score >= 8
      ? "text-emerald-500"
      : score >= 6
        ? "text-yellow-500"
        : score >= 4
          ? "text-orange-500"
          : "text-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-kumo-control overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${score * 10}%` }}
        />
      </div>
      <span className={`text-sm font-bold tabular-nums ${textColor}`}>{score}/10</span>
      <span className="text-xs text-kumo-inactive">{label}</span>
    </div>
  );
}

const SEVERITY_CONFIG: Record<
  IssueSeverity,
  { label: string; bg: string; text: string; ring: string; icon: React.ReactNode }
> = {
  critical: {
    label: "Critical",
    bg: "bg-red-500/10",
    text: "text-red-500",
    ring: "ring-red-500/30",
    icon: <XCircleIcon size={13} />
  },
  warning: {
    label: "Warning",
    bg: "bg-yellow-500/10",
    text: "text-yellow-500",
    ring: "ring-yellow-500/30",
    icon: <ShieldWarningIcon size={13} />
  },
  info: {
    label: "Info",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    ring: "ring-blue-500/30",
    icon: <InfoIcon size={13} />
  },
  good: {
    label: "Good",
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
    ring: "ring-emerald-500/30",
    icon: <CheckCircleIcon size={13} />
  }
};

const CATEGORY_ICONS: Record<IssueCategory, React.ReactNode> = {
  bug: <BugIcon size={11} />,
  security: <ShieldWarningIcon size={11} />,
  performance: <LightningIcon size={11} />,
  style: <PaintBrushIcon size={11} />,
  maintainability: <TreeStructureIcon size={11} />
};

function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg} ${cfg.text}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function CategoryChip({ category }: { category: IssueCategory }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-kumo-control text-kumo-inactive">
      {CATEGORY_ICONS[category]}
      {category}
    </span>
  );
}

// ── Custom tool output components ─────────────────────────────────────────

function AnalyzeCodeResult({ output }: { output: AnalyzeCodeOutput }) {
  const criticals = output.issues.filter((i) => i.severity === "critical");
  const warnings = output.issues.filter((i) => i.severity === "warning");
  const infos = output.issues.filter((i) => i.severity === "info");
  const goods = output.issues.filter((i) => i.severity === "good");
  const problemCount = criticals.length + warnings.length + infos.length;

  return (
    <Surface className="max-w-[90%] rounded-xl ring ring-kumo-line overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-kumo-line">
        <div className="flex items-center gap-2 mb-1.5">
          <CodeIcon size={15} className="text-kumo-brand" />
          <Text size="sm" bold>
            Code Analysis
          </Text>
          <Badge variant="secondary">{output.language}</Badge>
          {output.framework && <Badge variant="secondary">{output.framework}</Badge>}
          <span className="ml-auto text-xs text-kumo-inactive">
            {output.linesOfCode} lines
          </span>
        </div>
        <ScoreBar score={output.overallScore} />
      </div>

      {/* Summary */}
      <div className="px-4 py-2.5 border-b border-kumo-line">
        <Text size="xs" variant="secondary">
          {output.summary}
        </Text>
      </div>

      {/* Issue counts */}
      <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-kumo-line">
        {criticals.length > 0 && (
          <span className="text-xs font-medium text-red-500">
            {criticals.length} critical
          </span>
        )}
        {warnings.length > 0 && (
          <span className="text-xs font-medium text-yellow-500">
            {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
          </span>
        )}
        {infos.length > 0 && (
          <span className="text-xs font-medium text-blue-400">
            {infos.length} info
          </span>
        )}
        {goods.length > 0 && (
          <span className="text-xs font-medium text-emerald-500">
            {goods.length} good
          </span>
        )}
        {problemCount === 0 && goods.length === 0 && (
          <span className="text-xs text-kumo-inactive">No issues found</span>
        )}
      </div>

      {/* Issues */}
      {output.issues.length > 0 && (
        <div className="divide-y divide-kumo-line">
          {[...criticals, ...warnings, ...infos, ...goods].map((issue, i) => {
            const cfg = SEVERITY_CONFIG[issue.severity];
            return (
              <div key={i} className={`px-4 py-3 ${cfg.bg}`}>
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <SeverityBadge severity={issue.severity} />
                  <CategoryChip category={issue.category} />
                  {issue.line && (
                    <span className="text-[11px] font-mono text-kumo-inactive">
                      line {issue.line}
                    </span>
                  )}
                </div>
                <p className={`text-xs font-semibold mb-0.5 ${cfg.text}`}>{issue.title}</p>
                <p className="text-xs text-kumo-default mb-1">{issue.description}</p>
                {issue.severity !== "good" && (
                  <p className="text-xs text-kumo-inactive">
                    <span className="font-medium text-kumo-default">Fix: </span>
                    {issue.suggestion}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Surface>
  );
}

function PatternsResult({ output }: { output: PatternsOutput }) {
  if (output.patterns.length === 0) {
    return (
      <Surface className="max-w-[85%] px-4 py-3 rounded-xl ring ring-kumo-line">
        <div className="flex items-center gap-2 mb-1">
          <BookmarkSimpleIcon size={14} className="text-kumo-inactive" />
          <Text size="sm" bold>
            Your Patterns
          </Text>
        </div>
        <Text size="xs" variant="secondary">
          No patterns saved yet. As I review more of your code, I'll track recurring habits here.
        </Text>
      </Surface>
    );
  }

  return (
    <Surface className="max-w-[90%] rounded-xl ring ring-kumo-line overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-kumo-line flex items-center gap-2">
        <BookmarkSimpleIcon size={14} className="text-kumo-brand" />
        <Text size="sm" bold>
          Your Recurring Patterns
        </Text>
        <span className="ml-auto text-xs text-kumo-inactive">
          {output.totalReviews} review{output.totalReviews !== 1 ? "s" : ""}
          {output.averageScore !== null && ` · avg ${output.averageScore}/10`}
        </span>
      </div>
      <div className="divide-y divide-kumo-line">
        {output.patterns.map((p, i) => (
          <div key={i} className="px-4 py-2.5 flex items-start gap-2">
            <CategoryChip category={p.category as IssueCategory} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-kumo-default">{p.pattern}</p>
            </div>
            <span className="text-xs font-mono text-kumo-inactive shrink-0">
              ×{p.frequency}
            </span>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function RememberPatternResult({
  output
}: {
  output: { saved: boolean; pattern: string; category: string; frequency: number };
}) {
  return (
    <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
      <div className="flex items-center gap-2">
        <BookmarkSimpleIcon size={13} className="text-kumo-brand" />
        <Text size="xs" variant="secondary">
          Pattern saved{output.frequency > 1 ? ` (seen ${output.frequency}×)` : ""}:{" "}
          <span className="text-kumo-default">{output.pattern}</span>
        </Text>
      </div>
    </Surface>
  );
}

function StatsResult({ output }: { output: StatsOutput }) {
  if (output.message) {
    return (
      <Surface className="max-w-[85%] px-4 py-3 rounded-xl ring ring-kumo-line">
        <div className="flex items-center gap-2 mb-1">
          <ChartBarIcon size={14} className="text-kumo-inactive" />
          <Text size="sm" bold>
            Review Stats
          </Text>
        </div>
        <Text size="xs" variant="secondary">
          {output.message}
        </Text>
      </Surface>
    );
  }

  const trendIcon =
    output.trend === "improving" ? (
      <ArrowUpIcon size={12} className="text-emerald-500" />
    ) : output.trend === "declining" ? (
      <ArrowDownIcon size={12} className="text-red-500" />
    ) : (
      <MinusIcon size={12} className="text-kumo-inactive" />
    );

  const trendColor =
    output.trend === "improving"
      ? "text-emerald-500"
      : output.trend === "declining"
        ? "text-red-500"
        : "text-kumo-inactive";

  return (
    <Surface className="max-w-[90%] rounded-xl ring ring-kumo-line overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-kumo-line flex items-center gap-2">
        <ChartBarIcon size={14} className="text-kumo-brand" />
        <Text size="sm" bold>
          Review Statistics
        </Text>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 divide-x divide-kumo-line border-b border-kumo-line">
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-kumo-default">{output.totalReviews}</p>
          <p className="text-[11px] text-kumo-inactive mt-0.5">Reviews</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-kumo-default">{output.averageScore}</p>
          <p className="text-[11px] text-kumo-inactive mt-0.5">Avg score</p>
        </div>
        <div className="px-4 py-3 text-center">
          <div className={`flex items-center justify-center gap-1 text-xl font-bold ${trendColor}`}>
            {trendIcon}
            {output.recentAverage}
          </div>
          <p className="text-[11px] text-kumo-inactive mt-0.5">Recent avg</p>
        </div>
      </div>

      {/* Score range */}
      <div className="px-4 py-2 border-b border-kumo-line flex items-center gap-3">
        <Text size="xs" variant="secondary">
          Range: {output.lowestScore} – {output.highestScore}
        </Text>
        <span className="text-kumo-line">·</span>
        <Text size="xs" variant="secondary">
          {output.totalCriticalIssues} critical issues total
        </Text>
        {output.trend && output.trend !== "not enough data" && (
          <>
            <span className="text-kumo-line">·</span>
            <span className={`text-xs flex items-center gap-1 ${trendColor}`}>
              {trendIcon} {output.trend}
            </span>
          </>
        )}
      </div>

      {/* Language breakdown */}
      {output.languageBreakdown && output.languageBreakdown.length > 0 && (
        <div className="px-4 py-2.5 border-b border-kumo-line">
          <p className="text-xs font-semibold text-kumo-inactive mb-2">By Language</p>
          <div className="space-y-1.5">
            {output.languageBreakdown.map((lang) => (
              <div key={lang.language} className="flex items-center gap-2">
                <span className="text-xs text-kumo-default w-24 truncate">{lang.language}</span>
                <div className="flex-1 h-1.5 rounded-full bg-kumo-control overflow-hidden">
                  <div
                    className="h-full rounded-full bg-kumo-brand"
                    style={{
                      width: `${(lang.reviews / (output.totalReviews ?? 1)) * 100}%`
                    }}
                  />
                </div>
                <span className="text-[11px] text-kumo-inactive tabular-nums">
                  {lang.reviews} · {lang.avgScore}/10
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent reviews */}
      {output.recentReviews && output.recentReviews.length > 0 && (
        <div className="px-4 py-2.5">
          <p className="text-xs font-semibold text-kumo-inactive mb-2">Recent</p>
          <div className="space-y-1">
            {output.recentReviews.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-kumo-inactive w-16 shrink-0">{r.date}</span>
                <Badge variant="secondary">{r.language}</Badge>
                <span
                  className={`ml-auto font-mono font-bold ${
                    r.score >= 7
                      ? "text-emerald-500"
                      : r.score >= 5
                        ? "text-yellow-500"
                        : "text-red-500"
                  }`}
                >
                  {r.score}/10
                </span>
                {r.critical > 0 && (
                  <span className="text-red-500 text-[11px]">{r.critical} crit</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Surface>
  );
}

// ── Tool part renderer ────────────────────────────────────────────────────

function ToolPartView({
  part,
  addToolApprovalResponse
}: {
  part: UIMessage["parts"][number];
  addToolApprovalResponse: (response: { id: string; approved: boolean }) => void;
}) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  // Completed — dispatch to custom renderer
  if (part.state === "output-available") {
    const output = part.output as Record<string, unknown>;

    if (toolName === "analyzeCode") {
      return (
        <div className="flex justify-start">
          <AnalyzeCodeResult output={output as unknown as AnalyzeCodeOutput} />
        </div>
      );
    }
    if (toolName === "getMyPatterns") {
      return (
        <div className="flex justify-start">
          <PatternsResult output={output as unknown as PatternsOutput} />
        </div>
      );
    }
    if (toolName === "rememberPattern") {
      return (
        <div className="flex justify-start">
          <RememberPatternResult
            output={output as { saved: boolean; pattern: string; category: string; frequency: number }}
          />
        </div>
      );
    }
    if (toolName === "getReviewStats") {
      return (
        <div className="flex justify-start">
          <StatsResult output={output as unknown as StatsOutput} />
        </div>
      );
    }

    // Generic fallback
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          <pre className="font-mono text-xs text-kumo-secondary whitespace-pre-wrap">
            {JSON.stringify(output, null, 2)}
          </pre>
        </Surface>
      </div>
    );
  }

  // Needs approval
  if ("approval" in part && part.state === "approval-requested") {
    const approvalId = (part.approval as { id?: string })?.id;
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-3 rounded-xl ring-2 ring-kumo-warning">
          <div className="flex items-center gap-2 mb-2">
            <GearIcon size={14} className="text-kumo-warning" />
            <Text size="sm" bold>
              Approval needed: {toolName}
            </Text>
          </div>
          <div className="font-mono mb-3">
            <Text size="xs" variant="secondary">
              {JSON.stringify(part.input, null, 2)}
            </Text>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircleIcon size={14} />}
              onClick={() => {
                if (approvalId) addToolApprovalResponse({ id: approvalId, approved: true });
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<XCircleIcon size={14} />}
              onClick={() => {
                if (approvalId) addToolApprovalResponse({ id: approvalId, approved: false });
              }}
            >
              Reject
            </Button>
          </div>
        </Surface>
      </div>
    );
  }

  // Rejected
  if (
    part.state === "output-denied" ||
    ("approval" in part && (part.approval as { approved?: boolean })?.approved === false)
  ) {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <XCircleIcon size={14} className="text-kumo-danger" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Rejected</Badge>
          </div>
        </Surface>
      </div>
    );
  }

  // Executing
  if (part.state === "input-available" || part.state === "input-streaming") {
    const runningLabels: Record<string, string> = {
      analyzeCode: "Analysing code...",
      rememberPattern: "Saving pattern...",
      getMyPatterns: "Loading your patterns...",
      getReviewStats: "Fetching stats..."
    };
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              {runningLabels[toolName] ?? `Running ${toolName}...`}
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  return null;
}

// ── Starter prompts ───────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  "Show my review history and trends",
  "What patterns have you noticed in my code?",
  "Review this for security issues:\n```js\napp.get('/user', (req, res) => {\n  const id = req.query.id;\n  db.query(`SELECT * FROM users WHERE id = ${id}`, (err, result) => {\n    res.json(result);\n  });\n});\n```",
  "Review this TypeScript:\n```ts\nasync function fetchUser(id: string) {\n  const res = await fetch(`/api/users/${id}`);\n  const data = await res.json();\n  return data.user.name;\n}\n```"
];

// ── Main chat component ───────────────────────────────────────────────────

function Chat() {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent({
    agent: "CodeReviewAgent",
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback((error: Event) => console.error("WebSocket error:", error), [])
  });

  const { messages, sendMessage, clearHistory, addToolApprovalResponse, stop, status } =
    useAgentChat({ agent });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) textareaRef.current.focus();
  }, [isStreaming]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      {/* Header */}
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-kumo-default flex items-center gap-2">
              <CodeIcon size={20} weight="duotone" className="text-kumo-brand" />
              Code Review AI
            </h1>
            <Badge variant="secondary">
              <StarIcon size={11} weight="fill" className="mr-1 text-yellow-400" />
              Llama 3.3 · 70B
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <div className="flex items-center gap-1.5">
              <Text size="xs" variant="secondary">
                Debug
              </Text>
              <Switch
                checked={showDebug}
                onCheckedChange={setShowDebug}
                size="sm"
                aria-label="Toggle debug mode"
              />
            </div>
            <ThemeToggle />
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={clearHistory}
            >
              Clear
            </Button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
          {messages.length === 0 && (
            <Empty
              icon={<CodeIcon size={32} weight="duotone" />}
              title="Paste code for review"
              contents={
                <div className="space-y-3">
                  <p className="text-sm text-kumo-inactive text-center max-w-sm mx-auto">
                    I'll analyse bugs, security issues, performance, and style — and remember
                    your patterns over time.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {STARTER_PROMPTS.map((prompt) => {
                      const label =
                        prompt.length > 45 ? prompt.slice(0, 45).split("\n")[0] + "…" : prompt;
                      return (
                        <Button
                          key={label}
                          variant="outline"
                          size="sm"
                          disabled={isStreaming}
                          onClick={() =>
                            sendMessage({ role: "user", parts: [{ type: "text", text: prompt }] })
                          }
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              }
            />
          )}

          {messages.map((message: UIMessage, index: number) => {
            const isUser = message.role === "user";
            const isLastAssistant =
              message.role === "assistant" && index === messages.length - 1;

            return (
              <div key={message.id} className="space-y-2">
                {showDebug && (
                  <pre className="text-[11px] text-kumo-subtle bg-kumo-control rounded-lg p-3 overflow-auto max-h-64">
                    {JSON.stringify(message, null, 2)}
                  </pre>
                )}

                {/* Tool parts */}
                {message.parts.filter(isToolUIPart).map((part) => (
                  <ToolPartView
                    key={part.toolCallId}
                    part={part}
                    addToolApprovalResponse={addToolApprovalResponse}
                  />
                ))}

                {/* Reasoning parts */}
                {message.parts
                  .filter(
                    (part) =>
                      part.type === "reasoning" &&
                      (part as { text?: string }).text?.trim()
                  )
                  .map((part, i) => {
                    const reasoning = part as {
                      type: "reasoning";
                      text: string;
                      state?: "streaming" | "done";
                    };
                    const isDone = reasoning.state === "done" || !isStreaming;
                    return (
                      <div key={i} className="flex justify-start">
                        <details className="max-w-[85%] w-full" open={!isDone}>
                          <summary className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm select-none">
                            <BrainIcon size={14} className="text-purple-400" />
                            <span className="font-medium text-kumo-default">Reasoning</span>
                            {isDone ? (
                              <span className="text-xs text-kumo-success">Complete</span>
                            ) : (
                              <span className="text-xs text-kumo-brand">Thinking...</span>
                            )}
                            <CaretDownIcon size={14} className="ml-auto text-kumo-inactive" />
                          </summary>
                          <pre className="mt-2 px-3 py-2 rounded-lg bg-kumo-control text-xs text-kumo-default whitespace-pre-wrap overflow-auto max-h-64">
                            {reasoning.text}
                          </pre>
                        </details>
                      </div>
                    );
                  })}

                {/* Text parts */}
                {message.parts
                  .filter((part) => part.type === "text")
                  .map((part, i) => {
                    const text = (part as { type: "text"; text: string }).text;
                    if (!text) return null;

                    if (isUser) {
                      return (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed font-mono text-sm whitespace-pre-wrap">
                            {text}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={i} className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                          <Streamdown
                            className="sd-theme rounded-2xl rounded-bl-md p-3"
                            controls={false}
                            isAnimating={isLastAssistant && isStreaming}
                          >
                            {text}
                          </Streamdown>
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-kumo-line bg-kumo-base">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="max-w-3xl mx-auto px-5 py-4"
        >
          <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
            <InputArea
              ref={textareaRef}
              value={input}
              onValueChange={setInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder="Paste code to review, or ask about your history... (Shift+Enter for newline)"
              disabled={!connected || isStreaming}
              rows={1}
              className="flex-1 !ring-0 focus:!ring-0 !shadow-none !bg-transparent !outline-none resize-none max-h-64 font-mono text-sm"
            />
            {isStreaming ? (
              <Button
                type="button"
                variant="secondary"
                shape="square"
                aria-label="Stop generation"
                icon={<StopIcon size={18} />}
                onClick={stop}
                className="mb-0.5"
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                shape="square"
                aria-label="Send message"
                disabled={!input.trim() || !connected}
                icon={<PaperPlaneRightIcon size={18} />}
                className="mb-0.5"
              />
            )}
          </div>
          <p className="text-[11px] text-kumo-inactive mt-1.5 text-center">
            Powered by Llama 3.3 70B on Cloudflare Workers AI · Memory persists across sessions
          </p>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading...
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}
