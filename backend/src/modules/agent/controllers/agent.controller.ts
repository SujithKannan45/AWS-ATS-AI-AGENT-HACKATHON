import { Request, Response } from 'express';
import { IAgentService } from '../services/agent.service.interface.js';
import { ApiResponse } from '../../../shared/utils/api-response.js';
import { UnauthorizedError } from '../../../core/errors/app-error.js';

export class AgentController {
  private readonly agentService: IAgentService;

  constructor(agentService: IAgentService) {
    this.agentService = agentService;
  }

  /**
   * Resolves the verified Authorization header to forward to the Python agent.
   * Supports both Bearer header and HTTP-only cookie sessions.
   */
  private resolveAuthorization(req: Request): string {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      return header;
    }

    const cookieToken = req.cookies?.accessToken as string | undefined;
    if (cookieToken) {
      return `Bearer ${cookieToken}`;
    }

    throw new UnauthorizedError('Authentication required. Please log in.');
  }

  public chat = async (req: Request, res: Response): Promise<Response> => {
    const authorization = this.resolveAuthorization(req);

    const result = await this.agentService.chat(req.body.message, authorization);

    return ApiResponse.success(
      res,
      result,
      'AI agent response generated successfully'
    );
  };
}
