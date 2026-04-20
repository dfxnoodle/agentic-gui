import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/role.middleware.js';
import { conversationService } from '../services/conversation.service.js';
import { runnerService } from '../services/cli-runner/runner.service.js';
import { planService } from '../services/plan.service.js';
import { sseService } from '../services/sse.service.js';
import type { Message, Project, UnifiedEvent } from '@agentic-gui/shared';
import { FileStore } from '../store/file-store.js';
import { getProjectsDir } from '../store/store-paths.js';

const projectStore = new FileStore<Project>(getProjectsDir(), 'directory');

export const conversationRoutes = Router();
conversationRoutes.use(authMiddleware);

const createSchema = z.object({
  projectId: z.string().min(1),
  cliProvider: z.enum(['claude', 'codex', 'gemini', 'cursor', 'opencode']),
  title: z.string().optional(),
});

const messageSchema = z.object({
  content: z.string().min(1),
  secondOpinionCliProvider: z.enum(['claude', 'codex', 'gemini', 'cursor', 'opencode']).optional(),
});

async function reconcileConversationState(conversationId: string) {
  const conversation = await conversationService.getById(conversationId);
  if (!conversation) return null;

  const plans = await planService.getByConversation(conversationId);
  const hasPendingReviewPlan = plans.some((plan) => plan.status === 'pending_review');

  if (hasPendingReviewPlan && conversation.state !== 'awaiting_approval') {
    await conversationService.updateState(conversationId, 'awaiting_approval');
    return conversationService.getById(conversationId);
  }

  if (!hasPendingReviewPlan && conversation.state === 'awaiting_approval') {
    await conversationService.updateState(conversationId, 'active');
    return conversationService.getById(conversationId);
  }

  return conversation;
}

conversationRoutes.get('/', async (req, res, next) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const conversations = await conversationService.getAll(undefined, projectId);
    const reconciled = await Promise.all(
      conversations.map(async (conversation) => reconcileConversationState(conversation.id)),
    );
    res.json(reconciled.filter((conversation) => conversation !== null));
  } catch (err) {
    next(err);
  }
});

conversationRoutes.get('/:id', async (req, res, next) => {
  try {
    const conversation = await reconcileConversationState(req.params.id as string);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

conversationRoutes.post('/', requirePermission('create_conversation'), async (req, res, next) => {
  try {
    const { projectId, cliProvider, title } = createSchema.parse(req.body);
    const conversation = await conversationService.create(projectId, req.auth!.userId, cliProvider, title);
    res.status(201).json(conversation);
  } catch (err) {
    next(err);
  }
});

conversationRoutes.delete('/:id', requirePermission('create_conversation'), async (req, res, next) => {
  try {
    const deleted = await conversationService.delete(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

conversationRoutes.post('/:id/messages', requirePermission('send_message'), async (req, res, next) => {
  try {
    const conversationId = req.params.id as string;
    const { content, secondOpinionCliProvider } = messageSchema.parse(req.body);

    const conversation = await conversationService.getById(conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const project = await projectStore.read(conversation.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Use the project's current cliProvider (not the conversation's stale snapshot)
    const effectiveCLIProvider = project.cliProvider ?? conversation.cliProvider;

    if (secondOpinionCliProvider && secondOpinionCliProvider === effectiveCLIProvider) {
      res.status(400).json({ error: 'Second opinion must use a different CLI than the project default.' });
      return;
    }

    const message = await conversationService.addMessage(conversationId, 'user', content);
    res.status(201).json(message);

    await conversationService.updateState(conversationId, 'researching');

    sseService.send(conversationId, {
      type: 'state_change',
      conversationId,
      payload: { state: 'researching' },
    });

    try {
      const taskType = detectTaskType(content);

      const runJob = async (cliProvider: typeof effectiveCLIProvider) => {
        const job = await runnerService.runJob({
          conversationId,
          projectId: project.id,
          projectPath: project.rootPath,
          cliProvider,
          cliConfig: project.cliConfig,
          userMessage: content,
          taskType,
          credentialPreference: project.credentialPreference,
        });

        job.events.on('event', (event: UnifiedEvent) => {
          sseService.send(conversationId, {
            type: 'cli_event',
            conversationId,
            payload: event,
          });
        });

        return await job.completed;
      };

      const result = await runJob(effectiveCLIProvider);

      let assistantMetadata: Message['metadata'] = { cliProvider: effectiveCLIProvider };

      if (result.fullText) {
        if (taskType === 'plan' || looksLikePlan(result.fullText)) {
          try {
            const plan = await planService.createFromAIOutput(
              conversationId,
              project.id,
              result.fullText,
            );
            assistantMetadata = { ...assistantMetadata, planId: plan.id };

            await conversationService.updateState(conversationId, 'awaiting_approval');

            sseService.send(conversationId, {
              type: 'plan_update',
              conversationId,
              payload: { planId: plan.id, status: plan.status, title: plan.title, summary: plan.summary },
            });
          } catch (planErr) {
            console.error('Failed to create plan from AI output:', planErr);
          }
        }

        await conversationService.addMessage(conversationId, 'assistant', result.fullText, assistantMetadata);
      } else if (result.error) {
        await conversationService.addMessage(conversationId, 'system', `Error: ${result.error}`);
      }

      const updatedConv = await conversationService.getById(conversationId);
      const finalState = updatedConv?.state === 'awaiting_approval' ? 'awaiting_approval' : 'active';

      if (finalState === 'active') {
        await conversationService.updateState(conversationId, 'active');
      }

      sseService.send(conversationId, {
        type: 'state_change',
        conversationId,
        payload: {
          state: finalState,
          ...(result.fullText ? { assistantMetadata } : {}),
        },
      });

      const canRunSecondOpinion =
        Boolean(secondOpinionCliProvider) &&
        finalState === 'active' &&
        Boolean(result.fullText) &&
        !result.error;

      if (canRunSecondOpinion && secondOpinionCliProvider) {
        await conversationService.updateState(conversationId, 'researching');
        sseService.send(conversationId, {
          type: 'state_change',
          conversationId,
          payload: { state: 'researching' },
        });

        try {
          const result2 = await runJob(secondOpinionCliProvider);

          const secondMeta: Message['metadata'] = {
            cliProvider: secondOpinionCliProvider,
            secondOpinion: true,
          };

          if (result2.fullText) {
            await conversationService.addMessage(conversationId, 'assistant', result2.fullText, secondMeta);
          } else if (result2.error) {
            await conversationService.addMessage(
              conversationId,
              'system',
              `Second opinion error: ${result2.error}`,
            );
          }

          await conversationService.updateState(conversationId, 'active');
          sseService.send(conversationId, {
            type: 'state_change',
            conversationId,
            payload: {
              state: 'active',
              ...(result2.fullText ? { assistantMetadata: secondMeta } : {}),
            },
          });
        } catch (err2) {
          const errorMsg = err2 instanceof Error ? err2.message : 'Unknown error running CLI';
          await conversationService.addMessage(conversationId, 'system', `Second opinion error: ${errorMsg}`);
          await conversationService.updateState(conversationId, 'active');

          sseService.send(conversationId, {
            type: 'cli_event',
            conversationId,
            payload: {
              type: 'error',
              timestamp: new Date().toISOString(),
              content: errorMsg,
              source: secondOpinionCliProvider,
            } satisfies UnifiedEvent,
          });

          sseService.send(conversationId, {
            type: 'state_change',
            conversationId,
            payload: { state: 'active' },
          });
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error running CLI';
      await conversationService.addMessage(conversationId, 'system', `Error: ${errorMsg}`);
      await conversationService.updateState(conversationId, 'active');

      sseService.send(conversationId, {
        type: 'cli_event',
        conversationId,
        payload: {
          type: 'error',
          timestamp: new Date().toISOString(),
          content: errorMsg,
          source: effectiveCLIProvider,
        } satisfies UnifiedEvent,
      });

      sseService.send(conversationId, {
        type: 'state_change',
        conversationId,
        payload: { state: 'active' },
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Simple heuristic to detect what kind of task the user is asking for.
 */
function detectTaskType(message: string): 'research' | 'feasibility' | 'plan' {
  const lower = message.toLowerCase();

  if (
    lower.includes('create a plan') ||
    lower.includes('make a plan') ||
    lower.includes('implementation plan') ||
    lower.includes('plan for')
  ) {
    return 'plan';
  }

  if (
    lower.includes('feasib') ||
    lower.includes('possible to') ||
    lower.includes('can we') ||
    lower.includes('is it possible') ||
    lower.includes('how hard') ||
    lower.includes('how difficult') ||
    lower.includes('effort')
  ) {
    return 'feasibility';
  }

  return 'research';
}

/**
 * Check if AI output looks like a structured plan (has plan-like Markdown sections).
 */
function looksLikePlan(text: string): boolean {
  const lower = text.toLowerCase();
  const hasSummary = lower.includes('## summary');
  const hasApproach = lower.includes('## approach');
  const hasSteps = lower.includes('## steps') || lower.includes('## implementation');
  const hasRisks = lower.includes('## risk');
  const hasEffort = lower.includes('## effort') || lower.includes('## estimate');

  // Must have at least 3 plan-like sections
  const sectionCount = [hasSummary, hasApproach, hasSteps, hasRisks, hasEffort].filter(Boolean).length;
  return sectionCount >= 3;
}
