import type { CLIProvider } from './cli-events.js';

export type ConversationState = 'active' | 'researching' | 'planning' | 'awaiting_approval' | 'closed';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    thinkingContent?: string;
    toolsUsed?: string[];
    planId?: string;
    /** Which CLI produced this assistant message (primary or second opinion). */
    cliProvider?: CLIProvider;
    /** True when this block is the additional model’s answer in a second-opinion request. */
    secondOpinion?: boolean;
  };
  timestamp: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  state: ConversationState;
  cliProvider: CLIProvider;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}
