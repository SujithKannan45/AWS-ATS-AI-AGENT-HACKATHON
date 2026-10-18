import { z } from 'zod';

/**
 * Validates the inbound agent chat payload.
 * The client may only supply a message; the user identity is always derived
 * from the verified JWT on the server (never trusted from the request body).
 * The 8,000 character ceiling mirrors the Python agent's `max_user_message_chars` default.
 */
export const agentChatSchema = z.object({
  body: z.object({
    message: z
      .string({ required_error: 'message is required' })
      .trim()
      .min(1, 'message cannot be empty')
      .max(8000, 'message cannot exceed 8,000 characters'),
  }),
});
