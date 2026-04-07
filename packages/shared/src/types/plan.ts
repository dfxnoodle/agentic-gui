export type PlanStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'revision_requested' | 'committed';

export interface PlanSection {
  heading: string;
  body: string;
  estimatedEffort?: string;
}

export interface ContradictionConflict {
  existingMemory: string;
  proposedChange: string;
  explanation: string;
}

export interface ContradictionCheck {
  checkedAt: string;
  conflicts: ContradictionConflict[];
  verdict: 'no_conflicts' | 'conflicts_found';
}

export interface Plan {
  id: string;
  conversationId: string;
  projectId: string;
  version: number;
  title: string;
  summary: string;
  sections: PlanSection[];
  status: PlanStatus;
  contradictions: ContradictionCheck | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
