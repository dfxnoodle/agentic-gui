import type { PlanStatus } from '../types/plan.js';

export const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'rejected', 'revision_requested'],
  approved: ['committed'],
  rejected: [],
  revision_requested: ['pending_review'],
  committed: [],
};

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}
