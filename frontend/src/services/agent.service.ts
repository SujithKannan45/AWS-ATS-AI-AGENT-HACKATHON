import { apiClient } from './api.client';
import type { ApiResponse } from '@/types';

/**
 * Frontend mirror of the backend contract for `POST /api/v1/agent/chat`.
 *
 * The Express endpoint is a thin authenticated proxy in front of the Python
 * Strands Decider agent, so field names intentionally match the upstream
 * contract (`decision.selected_tool`, `decision.confidence`, ...).
 */
export interface IAgentDecision {
  pattern: string;
  selected_tool: string;
  confidence: number;
  latency_ms: number | null;
  raw_choice: string | null;
  used_fallback: boolean;
  intervention_events: Array<Record<string, unknown>>;
}

export interface IAgentChatResponse {
  reply: string;
  decision: IAgentDecision;
}

export interface AgentChatRequestDto {
  message: string;
}

/**
 * Agent inference runs through Bedrock and is much slower than a typical CRUD
 * call, so allow a longer window than the client-wide 30s default. This stays
 * above the backend proxy timeout so the server remains the source of truth.
 */
const AGENT_REQUEST_TIMEOUT_MS = 90_000;

export const agentService = {
  /**
   * Send a natural-language message to the AI Career Assistant.
   * The access token and user identity are attached server-side by the
   * Express proxy — the browser never sends or sees credentials.
   */
  async chat(message: string): Promise<IAgentChatResponse> {
    const payload: AgentChatRequestDto = { message };
    const response = await apiClient.post<ApiResponse<IAgentChatResponse>>(
      '/agent/chat',
      payload,
      { timeout: AGENT_REQUEST_TIMEOUT_MS }
    );
    return response.data.data;
  },
};
