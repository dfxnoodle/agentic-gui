import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/role.middleware.js';
import { planService } from '../services/plan.service.js';
import { memoryService } from '../services/memory.service.js';
import { contradictionService } from '../services/contradiction.service.js';
import { sseService } from '../services/sse.service.js';
import { conversationService } from '../services/conversation.service.js';
import { userService } from '../services/user.service.js';
import { runnerService } from '../services/cli-runner/runner.service.js';
import type { Message, Project, UnifiedEvent } from '@agentic-gui/shared';
import { FileStore } from '../store/file-store.js';
import { getProjectsDir } from '../store/store-paths.js';

const projectStore = new FileStore<Project>(getProjectsDir(), 'directory');

export const planRoutes = Router();
planRoutes.use(authMiddleware);

const createFromMessageSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});

async function clearAwaitingApprovalState(conversationId: string) {
  await conversationService.updateState(conversationId, 'active');
  sseService.send(conversationId, {
    type: 'state_change',
    conversationId,
    payload: { state: 'active' },
  });
}

// List plans (optionally filtered by projectId)
planRoutes.get('/', async (req, res, next) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const plans = await planService.getAll(projectId);
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

// Ask AI to generate and save a plan using an existing assistant message as context
planRoutes.post('/from-message', requirePermission('send_message'), async (req, res, next) => {
  try {
    const { conversationId, messageId } = createFromMessageSchema.parse(req.body);
    const conversation = await conversationService.getById(conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const message = conversation.messages.find((m) => m.id === messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.role !== 'assistant') {
      res.status(400).json({ error: 'Only assistant replies can be used to request a plan.' });
      return;
    }

    const project = await projectStore.read(conversation.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Return immediately, then run planning asynchronously with streaming updates.
    res.status(202).json({ accepted: true });

    await conversationService.updateState(conversationId, 'researching');
    sseService.send(conversationId, {
      type: 'state_change',
      conversationId,
      payload: { state: 'researching' },
    });

    const effectiveCLIProvider = project.cliProvider ?? conversation.cliProvider;
    const planningPrompt = [
      'Create a structured implementation plan from the following prior analysis.',
      'Return markdown with sections such as Summary, Approach, Steps, Risks, and Effort.',
      '',
      'Prior analysis:',
      message.content,
    ].join('\n');

    try {
      const job = await runnerService.runJob({
        conversationId,
        projectId: project.id,
        projectPath: project.rootPath,
        cliProvider: effectiveCLIProvider,
        cliConfig: project.cliConfig,
        userMessage: planningPrompt,
        taskType: 'plan',
        credentialPreference: project.credentialPreference,
      });

      job.events.on('event', (event: UnifiedEvent) => {
        sseService.send(conversationId, {
          type: 'cli_event',
          conversationId,
          payload: event,
        });
      });

      const result = await job.completed;
      if (!result.fullText) {
        const errorMsg = result.error ?? 'Plan generation returned no content.';
        await conversationService.addMessage(conversationId, 'system', `Error: ${errorMsg}`);
        await conversationService.updateState(conversationId, 'active');
        sseService.send(conversationId, {
          type: 'state_change',
          conversationId,
          payload: { state: 'active' },
        });
        return;
      }

      const plan = await planService.createFromAIOutput(conversationId, project.id, result.fullText);
      const assistantMetadata: Message['metadata'] = {
        cliProvider: effectiveCLIProvider,
        planId: plan.id,
      };

      await conversationService.addMessage(conversationId, 'assistant', result.fullText, assistantMetadata);
      await conversationService.updateMessageMetadata(conversationId, messageId, { planId: plan.id });
      await conversationService.updateState(conversationId, 'awaiting_approval');

      sseService.send(conversationId, {
        type: 'plan_update',
        conversationId,
        payload: { planId: plan.id, status: plan.status, title: plan.title, summary: plan.summary },
      });

      sseService.send(conversationId, {
        type: 'state_change',
        conversationId,
        payload: {
          state: 'awaiting_approval',
          assistantMetadata,
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error generating plan';
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

// Get plan by ID
planRoutes.get('/:id', async (req, res, next) => {
  try {
    const plan = await planService.getById(req.params.id as string);
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// Get plans for a conversation
planRoutes.get('/conversation/:conversationId', async (req, res, next) => {
  try {
    const plans = await planService.getByConversation(req.params.conversationId as string);
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

// Approve plan -> triggers contradiction check -> commits to MEMORY.md
planRoutes.post('/:id/approve', requirePermission('approve_plan'), async (req, res, next) => {
  try {
    const planId = req.params.id as string;
    const plan = await planService.getById(planId);
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    if (plan.status !== 'pending_review') {
      res.status(400).json({ error: `Plan is in '${plan.status}' state, not 'pending_review'` });
      return;
    }

    const project = await projectStore.read(plan.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Transition to approved
    const approvedPlan = await planService.transition(planId, 'approved', req.auth!.userId);
    await clearAwaitingApprovalState(plan.conversationId);

    // Notify via SSE
    sseService.send(plan.conversationId, {
      type: 'plan_update',
      conversationId: plan.conversationId,
      payload: { planId, status: 'approved', phase: 'checking_contradictions' },
    });

    const check = await contradictionService.check(
      approvedPlan,
      project.rootPath,
      project.cliProvider,
      project.cliConfig,
      project.credentialPreference,
    );

    const checkedPlan = await planService.setContradictions(planId, check);

    if (check.verdict === 'conflicts_found') {
      // Notify user of conflicts
      sseService.send(plan.conversationId, {
        type: 'plan_update',
        conversationId: plan.conversationId,
        payload: { planId, status: 'approved', contradictions: check },
      });

      res.json(checkedPlan);
      return;
    }

    // No conflicts — commit to MEMORY.md before reporting success to the caller.
    const approver = await userService.getById(req.auth!.userId);
    const approverName = approver ? `${approver.displayName} (${approver.role})` : req.auth!.username;

    await memoryService.appendPlan(project.rootPath, approvedPlan, approverName);
    const committedPlan = await planService.transition(planId, 'committed');

    sseService.send(plan.conversationId, {
      type: 'plan_update',
      conversationId: plan.conversationId,
      payload: { planId, status: 'committed' },
    });

    res.json(committedPlan);
  } catch (err) {
    next(err);
  }
});

// Force-commit (override contradictions)
planRoutes.post('/:id/force-commit', requirePermission('approve_plan'), async (req, res, next) => {
  try {
    const planId = req.params.id as string;
    const plan = await planService.getById(planId);
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    if (plan.status !== 'approved') {
      res.status(400).json({ error: 'Plan must be approved before force-committing' });
      return;
    }

    const project = await projectStore.read(plan.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const approver = await userService.getById(plan.approvedBy ?? req.auth!.userId);
    const approverName = approver ? `${approver.displayName} (${approver.role})` : req.auth!.username;

    await memoryService.appendPlan(project.rootPath, plan, approverName);
    const committed = await planService.transition(planId, 'committed');
    await clearAwaitingApprovalState(plan.conversationId);

    sseService.send(plan.conversationId, {
      type: 'plan_update',
      conversationId: plan.conversationId,
      payload: { planId, status: 'committed' },
    });

    res.json(committed);
  } catch (err) {
    next(err);
  }
});

// Reject plan
planRoutes.post('/:id/reject', requirePermission('reject_plan'), async (req, res, next) => {
  try {
    const plan = await planService.transition(req.params.id as string, 'rejected');
    await clearAwaitingApprovalState(plan.conversationId);

    sseService.send(plan.conversationId, {
      type: 'plan_update',
      conversationId: plan.conversationId,
      payload: { planId: plan.id, status: 'rejected' },
    });

    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// Request changes
planRoutes.post('/:id/request-changes', requirePermission('request_changes'), async (req, res, next) => {
  try {
    const plan = await planService.transition(req.params.id as string, 'revision_requested');
    await clearAwaitingApprovalState(plan.conversationId);

    sseService.send(plan.conversationId, {
      type: 'plan_update',
      conversationId: plan.conversationId,
      payload: { planId: plan.id, status: 'revision_requested' },
    });

    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// Delete plan
planRoutes.delete('/:id', requirePermission('reject_plan'), async (req, res, next) => {
  try {
    const planId = req.params.id as string;
    const plan = await planService.getById(planId);
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    const deleted = await planService.delete(planId);
    if (!deleted) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    if (plan.status === 'pending_review') {
      await clearAwaitingApprovalState(plan.conversationId);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
