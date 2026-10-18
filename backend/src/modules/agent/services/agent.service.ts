import { IAgentService } from './agent.service.interface.js';
import { AgentChatResponseDto } from '../dtos/agent-chat.dto.js';
import { AgentClientUtil } from '../utils/agent-client.util.js';
import { BadRequestError } from '../../../core/errors/app-error.js';
import { logger } from '../../../core/logger/logger.js';

export class AgentService implements IAgentService {
  public async chat(
    message: string,
    authorization: string
  ): Promise<AgentChatResponseDto> {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      throw new BadRequestError('message cannot be empty.');
    }

    const result = await AgentClientUtil.sendChat({
      message: trimmedMessage,
      authorization,
    });

    logger.ai('Agent chat completed', {
      pattern: result.decision?.pattern,
      selectedTool: result.decision?.selected_tool,
      confidence: result.decision?.confidence,
      usedFallback: result.decision?.used_fallback,
    });

    return result;
  }
}
