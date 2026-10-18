import { Router } from 'express';
import { AgentController } from '../controllers/agent.controller.js';
import { AgentService } from '../services/agent.service.js';
import { authenticate } from '../../auth/middlewares/auth.middleware.js';
import { validateRequest } from '../../../core/middlewares/validate.middleware.js';
import { asyncHandler } from '../../../core/middlewares/async-handler.middleware.js';
import { agentChatSchema } from '../validators/agent.validator.js';

const router = Router();

// Instantiate Dependency Injection Tree
const agentService = new AgentService();
const agentController = new AgentController(agentService);

// All agent routes require a valid JWT session
router.use(authenticate);

// Forward a chat message to the Python Strands Decider agent
router.post(
  '/chat',
  validateRequest(agentChatSchema),
  asyncHandler(agentController.chat)
);

export const agentRoutes = router;
