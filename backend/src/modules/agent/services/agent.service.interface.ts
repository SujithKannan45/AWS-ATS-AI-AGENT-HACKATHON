import { AgentChatResponseDto } from '../dtos/agent-chat.dto.js';

export interface IAgentService {
  /**
   * Forwards a validated chat message to the Python Strands agent using the
   * caller's verified Authorization header.
   */
  chat(message: string, authorization: string): Promise<AgentChatResponseDto>;
}
