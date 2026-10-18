import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Bot,
  Send,
  Sparkles,
  Target,
  Briefcase,
  FileSearch,
  Trash2,
  Gauge,
  Wand2,
  CheckCircle2,
  User as UserIcon,
} from 'lucide-react';
import {
  agentService,
  type IAgentDecision,
  type IAgentChatResponse,
} from '@/services/agent.service';
import { resumeService } from '@/services/resume.service';
import { jobService } from '@/services/job.service';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/cn';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  decision?: IAgentDecision;
}

interface QuickPrompt {
  id: string;
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

const MAX_MESSAGE_LENGTH = 8000;

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * The agent reports confidence as a probability; render it as a percentage
 * without assuming a fixed scale.
 */
function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function confidencePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const pct = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/** Compact, non-sensitive summary of the agent's routing decision. */
function DecisionPanel({ decision }: { decision: IAgentDecision }) {
  const percent = confidencePercent(decision.confidence);

  return (
    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <Gauge className="h-3.5 w-3.5" />
        Agent Decision
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="info" className="gap-1 font-mono text-[11px]">
          <Wand2 className="h-3 w-3" />
          {decision.selected_tool || 'unknown'}
        </Badge>
        <Badge
          variant={
            percent >= 80 ? 'success' : percent >= 50 ? 'secondary' : 'warning'
          }
          className="text-[11px]"
        >
          Confidence {formatConfidence(decision.confidence)}
        </Badge>
        {decision.pattern && (
          <Badge variant="outline" className="font-mono text-[11px]">
            {decision.pattern}
          </Badge>
        )}
        {decision.used_fallback && (
          <Badge variant="warning" className="text-[11px]">
            Fallback
          </Badge>
        )}
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {decision.latency_ms != null && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Decision latency: <span className="font-medium">{decision.latency_ms} ms</span>
        </p>
      )}
    </div>
  );
}

export function AgentChatPage() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Reuse existing resume vault context to power natural-language prompts.
  const { data: resume, isLoading: loadingResume } = useQuery({
    queryKey: ['current-resume'],
    queryFn: () => resumeService.getCurrentResume(),
  });

  // Reuse existing job tracker data so the assistant can be asked about matches.
  const { data: jobsData, isLoading: loadingJobs } = useQuery({
    queryKey: ['agent-job-context'],
    queryFn: () => jobService.getAllJobs({ limit: 5, sortBy: 'updatedAt', sortOrder: 'desc' }),
  });

  const trackedJobs = jobsData?.jobs ?? [];
  const totalJobs = jobsData?.pagination?.totalItems ?? trackedJobs.length;
  const topJob = trackedJobs[0];

  const chatMutation = useMutation({
    mutationFn: (message: string): Promise<IAgentChatResponse> => agentService.chat(message),
    onSuccess: (data) => {
      setErrorMessage(null);
      setMessages((prev) => [
        ...prev,
        { id: createId(), role: 'assistant', content: data.reply, decision: data.decision },
      ]);
    },
    onError: (err: unknown) => {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'The assistant could not respond right now. Please try again.'
      );
    },
  });

  const isSending = chatMutation.isPending;

  const quickPrompts: QuickPrompt[] = React.useMemo(() => {
    const prompts: QuickPrompt[] = [
      {
        id: 'ats-gaps',
        label: 'Find my biggest ATS gaps',
        prompt: 'Analyze my resume and highlight the biggest ATS gaps I should fix first.',
        icon: <FileSearch className="h-4 w-4" />,
      },
    ];

    if (resume) {
      prompts.push({
        id: 'resume-review',
        label: 'Review my active resume',
        prompt: `Review my active resume "${resume.fileName}" and suggest concrete improvements.`,
        icon: <Sparkles className="h-4 w-4" />,
      });
    }

    if (topJob) {
      prompts.push({
        id: 'job-match',
        label: `Match me to ${topJob.jobTitle}`,
        prompt: `Match my resume against the ${topJob.jobTitle} role at ${topJob.companyName} and explain the fit.`,
        icon: <Target className="h-4 w-4" />,
      });
    }

    if (totalJobs > 0) {
      prompts.push({
        id: 'best-fit',
        label: 'Which tracked job fits me best?',
        prompt: 'Across the jobs I am tracking, which one is the strongest fit for my profile and why?',
        icon: <Briefcase className="h-4 w-4" />,
      });
    }

    return prompts;
  }, [resume, topJob, totalJobs]);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, isSending, errorMessage]);

  const sendMessage = React.useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || isSending) return;

      setMessages((prev) => [...prev, { id: createId(), role: 'user', content: message }]);
      setInput('');
      setErrorMessage(null);
      chatMutation.mutate(message);
    },
    [chatMutation, isSending]
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setErrorMessage(null);
    setInput('');
    chatMutation.reset();
    textareaRef.current?.focus();
  };

  const hasTranscript = messages.length > 0 || isSending || Boolean(errorMessage);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Career Assistant"
        description="Chat with your Strands Decider agent to analyze your resume, match roles, and plan your next career move."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'AI Assistant' }]}
        action={
          hasTranscript ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              className="gap-2"
              aria-label="Clear conversation"
            >
              <Trash2 className="h-4 w-4" /> Clear chat
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Conversation */}
        <Card className="flex flex-col overflow-hidden lg:col-span-2">
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
            style={{ minHeight: '24rem', maxHeight: '60vh' }}
            aria-live="polite"
            aria-busy={isSending}
          >
            {messages.length === 0 && !isSending && !errorMessage && (
              <EmptyState
                icon={<Bot className="h-8 w-8" />}
                title="Ask your AI Career Assistant"
                description="Request a resume analysis, compare yourself against a tracked role, or get tailored career guidance — in plain English."
                className="border-none"
              />
            )}

            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isSending && <ThinkingIndicator />}

            {errorMessage && (
              <Alert variant="destructive" title="Assistant unavailable">
                {errorMessage}
              </Alert>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-border bg-card/60 p-3 sm:p-4"
          >
            <label htmlFor="agent-message" className="sr-only">
              Message the AI Career Assistant
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="agent-message"
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                maxLength={MAX_MESSAGE_LENGTH}
                disabled={isSending}
                placeholder="e.g. Analyze my resume and tell me which skills to add for a Senior React role..."
                className={cn(
                  'max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                )}
              />
              <Button
                type="submit"
                variant="gradient"
                size="icon"
                disabled={!input.trim() || isSending}
                isLoading={isSending}
                aria-label="Send message"
                className="h-11 w-11 shrink-0"
              >
                {!isSending && <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Press Enter to send, Shift + Enter for a new line.</span>
              <span>
                {input.length}/{MAX_MESSAGE_LENGTH}
              </span>
            </div>
          </form>
        </Card>

        {/* Career context + suggestions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-semibold">Suggested prompts</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">
                Powered by your active resume and tracked jobs.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => sendMessage(prompt.prompt)}
                  disabled={isSending}
                  className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-card p-3 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="mt-0.5 text-primary">{prompt.icon}</span>
                  <span className="flex-1">{prompt.label}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Career context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="rounded-lg border border-border bg-card/60 p-3">
                <p className="font-semibold text-muted-foreground">Active resume</p>
                {loadingResume ? (
                  <Skeleton className="mt-2 h-4 w-3/4" />
                ) : resume ? (
                  <div className="mt-1 flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="truncate font-medium text-foreground">
                      {resume.fileName}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    No resume in your vault yet.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card/60 p-3">
                <p className="font-semibold text-muted-foreground">Tracked jobs</p>
                {loadingJobs ? (
                  <Skeleton className="mt-2 h-4 w-1/2" />
                ) : (
                  <p className="mt-1 font-medium text-foreground">
                    {totalJobs} role{totalJobs === 1 ? '' : 's'} in your tracker
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div className={cn('max-w-[85%] sm:max-w-[75%]', isUser && 'order-first')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'rounded-br-sm bg-primary text-primary-foreground'
              : 'rounded-bl-sm border border-border bg-card text-card-foreground'
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        {!isUser && message.decision && <DecisionPanel decision={message.decision} />}
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-3" role="status" aria-label="Assistant is thinking">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
        <span className="sr-only">The assistant is analyzing your request.</span>
      </div>
    </div>
  );
}
