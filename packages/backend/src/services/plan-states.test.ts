import { describe, it, expect } from 'vitest';
import { canTransition } from '@agentic-gui/shared';

describe('canTransition (plan state machine)', () => {
  it('allows pending_review → approved', () => {
    expect(canTransition('pending_review', 'approved')).toBe(true);
  });

  it('allows pending_review → rejected', () => {
    expect(canTransition('pending_review', 'rejected')).toBe(true);
  });

  it('allows pending_review → revision_requested', () => {
    expect(canTransition('pending_review', 'revision_requested')).toBe(true);
  });

  it('allows approved → committed', () => {
    expect(canTransition('approved', 'committed')).toBe(true);
  });

  it('blocks pending_review → committed directly', () => {
    expect(canTransition('pending_review', 'committed')).toBe(false);
  });

  it('blocks committed → anything', () => {
    expect(canTransition('committed', 'approved')).toBe(false);
    expect(canTransition('committed', 'pending_review')).toBe(false);
  });

  it('blocks rejected → approved', () => {
    expect(canTransition('rejected', 'approved')).toBe(false);
  });

  it('allows revision_requested → pending_review', () => {
    expect(canTransition('revision_requested', 'pending_review')).toBe(true);
  });
});
