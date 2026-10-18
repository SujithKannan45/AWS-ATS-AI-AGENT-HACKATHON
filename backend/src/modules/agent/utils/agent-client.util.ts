import { envConfig } from '../../../config/env.config.js';
import { logger } from '../../../core/logger/logger.js';
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  HttpStatusCode,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../../core/errors/app-error.js';
import { AgentChatResponseDto } from '../dtos/agent-chat.dto.js';

const CHAT_PATH = '/v1/chat';

export interface AgentChatInvocation {
  message: string;
  authorization: string;
}

/**
 * Low-level HTTP transport for the Python Strands Decider agent.
 * Keeps Bedrock/AWS credentials (owned by the agent process) entirely server-side:
 * only the caller's JWT is forwarded, never any credential.
 */
export class AgentClientUtil {
  private static buildChatUrl(): string {
    return `${envConfig.AGENT_SERVICE_URL.replace(/\/+$/, '')}${CHAT_PATH}`;
  }

  public static async sendChat(
    invocation: AgentChatInvocation
  ): Promise<AgentChatResponseDto> {
    const url = this.buildChatUrl();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      envConfig.AGENT_SERVICE_TIMEOUT_MS
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: invocation.authorization,
        },
        body: JSON.stringify({ message: invocation.message }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.ai('Agent service request timed out', {
          url,
          timeoutMs: envConfig.AGENT_SERVICE_TIMEOUT_MS,
        });
        throw new AppError(
          'The AI agent did not respond in time. Please retry with a shorter request.',
          HttpStatusCode.GATEWAY_TIMEOUT
        );
      }

      logger.ai('Agent service is unreachable', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(
        'The AI agent service is currently unavailable. Please try again shortly.',
        HttpStatusCode.SERVICE_UNAVAILABLE
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await response.text();
    const payload = this.parseJson(rawBody);

    if (!response.ok) {
      throw this.mapErrorResponse(response.status, payload);
    }

    return this.assertChatResponse(payload);
  }

  private static parseJson(rawBody: string): unknown {
    if (!rawBody) return null;
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return null;
    }
  }

  private static extractDetail(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || !('detail' in payload)) {
      return '';
    }

    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }

    // FastAPI structured validation error shape: [{ msg, loc }, ...]
    if (Array.isArray(detail)) {
      return detail
        .map((entry) =>
          entry && typeof entry === 'object' && 'msg' in entry
            ? String((entry as { msg: unknown }).msg)
            : JSON.stringify(entry)
        )
        .join('; ');
    }

    return '';
  }

  private static mapErrorResponse(status: number, payload: unknown): AppError {
    const detail = this.extractDetail(payload);

    switch (status) {
      case HttpStatusCode.BAD_REQUEST:
        return new BadRequestError(
          detail || 'The AI agent rejected the request as invalid.'
        );
      case HttpStatusCode.UNAUTHORIZED:
        return new UnauthorizedError(
          detail || 'The AI agent could not authenticate the request.'
        );
      case HttpStatusCode.FORBIDDEN:
        return new ForbiddenError(
          detail || 'You do not have permission to perform this action.'
        );
      case HttpStatusCode.NOT_FOUND:
        return new NotFoundError(
          detail || 'The requested resource was not found by the AI agent.'
        );
      case HttpStatusCode.TOO_MANY_REQUESTS:
        return new TooManyRequestsError(
          detail || 'AI agent rate limit reached. Please try again shortly.'
        );
      case HttpStatusCode.SERVICE_UNAVAILABLE:
        return new AppError(
          'The AI agent service is temporarily unavailable. Please try again shortly.',
          HttpStatusCode.SERVICE_UNAVAILABLE
        );
      case HttpStatusCode.GATEWAY_TIMEOUT:
        return new AppError(
          'The AI agent did not respond in time. Please retry.',
          HttpStatusCode.GATEWAY_TIMEOUT
        );
      default:
        // Never surface internal 5xx payloads from the upstream agent.
        return new AppError(
          'The AI agent returned an unexpected error. Please try again.',
          HttpStatusCode.BAD_GATEWAY
        );
    }
  }

  private static assertChatResponse(payload: unknown): AgentChatResponseDto {
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof (payload as { reply?: unknown }).reply !== 'string'
    ) {
      logger.ai('Agent service returned a malformed chat payload');
      throw new AppError(
        'The AI agent returned an unexpected response format.',
        HttpStatusCode.BAD_GATEWAY
      );
    }

    return payload as AgentChatResponseDto;
  }
}
