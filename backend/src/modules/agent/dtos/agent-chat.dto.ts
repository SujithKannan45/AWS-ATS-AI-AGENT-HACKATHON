/**
 * DTOs describing the contract of the Python Strands Decider agent (`POST /v1/chat`).
 * Field names intentionally mirror the upstream agent contract so the response can be
 * proxied through without lossy translation.
 */

export interface AgentChatRequestDto {
  message: string;
}

export interface AgentDecisionDto {
  pattern: string;
  selected_tool: string;
  confidence: number;
  latency_ms: number | null;
  raw_choice: string | null;
  used_fallback: boolean;
  intervention_events: Array<Record<string, unknown>>;
}

export interface AgentChatResponseDto {
  reply: string;
  decision: AgentDecisionDto;
}
