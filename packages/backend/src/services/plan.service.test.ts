import { describe, expect, it } from 'vitest';
import type { Plan } from '@agentic-gui/shared';
import { normalizePlan, parsePlanMarkdown } from './plan.service.js';

describe('parsePlanMarkdown', () => {
  it('uses the Summary section as metadata without keeping it as a section', () => {
    const parsed = parsePlanMarkdown(`# Plan: Inventory Sync\n\n## Summary\nMerge JART supply data into the dashboard.\n\n## Approach\nCall both Odoo instances and combine the results.\n\n## Steps\n1. Add API client\n2. Merge responses`);

    expect(parsed.title).toBe('Inventory Sync');
    expect(parsed.summary).toBe('Merge JART supply data into the dashboard.');
    expect(parsed.sections.map((section) => section.heading)).toEqual(['Approach', 'Steps']);
  });
});

describe('normalizePlan', () => {
  it('removes legacy Summary sections from persisted plans', () => {
    const plan: Plan = {
      id: 'plan-1',
      conversationId: 'conversation-1',
      projectId: 'project-1',
      version: 1,
      title: 'Implementation Plan',
      summary: 'Merge JART supply data into the dashboard.',
      sections: [
        {
          heading: 'Summary',
          body: 'Merge JART supply data into the dashboard.',
        },
        {
          heading: 'Approach',
          body: 'Call both Odoo instances and combine the results.',
        },
      ],
      status: 'pending_review',
      contradictions: null,
      approvedBy: null,
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
    };

    const normalized = normalizePlan(plan);

    expect(normalized.summary).toBe(plan.summary);
    expect(normalized.sections).toEqual([
      {
        heading: 'Approach',
        body: 'Call both Odoo instances and combine the results.',
      },
    ]);
  });

  it('promotes a legacy Summary section when the top-level summary is empty', () => {
    const plan: Plan = {
      id: 'plan-2',
      conversationId: 'conversation-2',
      projectId: 'project-2',
      version: 1,
      title: 'Implementation Plan',
      summary: '',
      sections: [
        {
          heading: 'Summary',
          body: 'Backfill the summary from the legacy section.',
        },
        {
          heading: 'Steps',
          body: '1. Normalize the plan\n2. Return clean sections',
        },
      ],
      status: 'draft',
      contradictions: null,
      approvedBy: null,
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
    };

    const normalized = normalizePlan(plan);

    expect(normalized.summary).toBe('Backfill the summary from the legacy section.');
    expect(normalized.sections.map((section) => section.heading)).toEqual(['Steps']);
  });
});