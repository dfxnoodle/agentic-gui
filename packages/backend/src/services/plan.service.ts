import type { Plan, PlanSection, PlanStatus, ContradictionCheck } from '@agentic-gui/shared';
import { canTransition } from '@agentic-gui/shared';
import { FileStore } from '../store/file-store.js';
import { getPlansDir } from '../store/store-paths.js';
import { nanoid } from 'nanoid';

const store = new FileStore<Plan>(getPlansDir(), 'directory');

function isSummaryHeading(heading: string): boolean {
  return heading.trim().toLowerCase() === 'summary';
}

function buildFallbackSummary(content: string): string {
  const trimmed = content.slice(0, 200).replace(/[#*_]/g, '').trim();
  return content.length > 200 ? `${trimmed}...` : trimmed;
}

export function normalizePlan(plan: Plan): Plan {
  let summary = plan.summary.trim();
  const sections = plan.sections.filter((section) => {
    if (!isSummaryHeading(section.heading)) return true;

    if (!summary) {
      summary = section.body.trim();
    }

    return false;
  });

  if (!summary) {
    const fallbackSource = sections.map((section) => section.body).find((body) => body.trim());
    summary = fallbackSource ? buildFallbackSummary(fallbackSource) : '';
  }

  return {
    ...plan,
    summary,
    sections,
  };
}

export const planService = {
  async getAll(projectId?: string): Promise<Plan[]> {
    const all = await store.readAll();
    const plans = projectId ? all.filter((p) => p.projectId === projectId) : all;
    return plans.map(normalizePlan);
  },

  async getById(id: string): Promise<Plan | null> {
    const plan = await store.read(id);
    return plan ? normalizePlan(plan) : null;
  },

  async getByConversation(conversationId: string): Promise<Plan[]> {
    const all = await store.readAll();
    return all.filter((p) => p.conversationId === conversationId).map(normalizePlan);
  },

  /**
   * Create a plan from AI-generated content.
   * Parses Markdown sections out of the raw text.
   */
  async createFromAIOutput(
    conversationId: string,
    projectId: string,
    rawText: string,
  ): Promise<Plan> {
    const { title, summary, sections } = parsePlanMarkdown(rawText);

    // Check for existing plans in this conversation to set version
    const existing = await this.getByConversation(conversationId);
    const version = existing.length + 1;

    const plan = normalizePlan({
      id: nanoid(),
      conversationId,
      projectId,
      version,
      title,
      summary,
      sections,
      status: 'pending_review',
      contradictions: null,
      approvedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await store.write(plan);
    return plan;
  },

  async transition(id: string, newStatus: PlanStatus, approvedBy?: string): Promise<Plan> {
    const storedPlan = await store.read(id);
    const plan = storedPlan ? normalizePlan(storedPlan) : null;
    if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

    if (!canTransition(plan.status, newStatus)) {
      throw Object.assign(
        new Error(`Cannot transition plan from '${plan.status}' to '${newStatus}'`),
        { status: 400 },
      );
    }

    plan.status = newStatus;
    plan.updatedAt = new Date().toISOString();
    if (approvedBy) plan.approvedBy = approvedBy;

    await store.write(plan);
    return plan;
  },

  async setContradictions(id: string, check: ContradictionCheck): Promise<Plan> {
    const storedPlan = await store.read(id);
    const plan = storedPlan ? normalizePlan(storedPlan) : null;
    if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

    plan.contradictions = check;
    plan.updatedAt = new Date().toISOString();
    await store.write(plan);
    return plan;
  },

  async delete(id: string): Promise<boolean> {
    return store.delete(id);
  },
};

/**
 * Parse an AI-generated Markdown plan into structured sections.
 */
export function parsePlanMarkdown(raw: string): {
  title: string;
  summary: string;
  sections: PlanSection[];
} {
  const lines = raw.split('\n');
  const sections: PlanSection[] = [];
  let title = 'Implementation Plan';
  let summary = '';
  let currentHeading = '';
  let currentBody: string[] = [];

  function flushSection() {
    if (currentHeading) {
      const body = currentBody.join('\n').trim();
      const summarySection = isSummaryHeading(currentHeading);

      // Extract the summary from the Summary section
      if (summarySection && !summary) {
        summary = body;
      }

      if (summarySection) {
        currentHeading = '';
        currentBody = [];
        return;
      }

      // Detect estimated effort
      let estimatedEffort: string | undefined;
      if (currentHeading.toLowerCase().includes('effort') || currentHeading.toLowerCase().includes('estimate')) {
        estimatedEffort = body.split('\n')[0];
      }

      sections.push({
        heading: currentHeading,
        body,
        estimatedEffort,
      });
    }
    currentHeading = '';
    currentBody = [];
  }

  for (const line of lines) {
    // Top-level title (# Plan: ...)
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match && title === 'Implementation Plan') {
      title = h1Match[1].replace(/^Plan:\s*/i, '').trim();
      continue;
    }

    // Section heading (## ...)
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      flushSection();
      currentHeading = h2Match[1].trim();
      continue;
    }

    currentBody.push(line);
  }
  flushSection();

  // If no summary was extracted from a Summary section, use first 200 chars
  if (!summary) {
    summary = buildFallbackSummary(raw);
  }

  return { title, summary, sections };
}
