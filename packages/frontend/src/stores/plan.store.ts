import { defineStore } from 'pinia';
import { ref } from 'vue';
import { plansApi } from '../api/plans.api';
import { useConversationStore } from './conversation.store';
import type { Plan } from '@agentic-gui/shared';

export const usePlanStore = defineStore('plan', () => {
  const plans = ref<Plan[]>([]);
  const activePlan = ref<Plan | null>(null);
  const loading = ref(false);

  async function fetchPlans(projectId?: string) {
    loading.value = true;
    try {
      plans.value = await plansApi.list(projectId);
    } finally {
      loading.value = false;
    }
  }

  async function fetchPlan(id: string) {
    loading.value = true;
    try {
      activePlan.value = await plansApi.get(id);
    } finally {
      loading.value = false;
    }
  }

  async function fetchByConversation(conversationId: string) {
    const result = await plansApi.getByConversation(conversationId);
    // Merge into plans list
    for (const plan of result) {
      const idx = plans.value.findIndex((p) => p.id === plan.id);
      if (idx >= 0) {
        plans.value[idx] = plan;
      } else {
        plans.value.push(plan);
      }
    }
    return result;
  }

  async function createFromMessage(conversationId: string, messageId: string) {
    const conversationStore = useConversationStore();
    try {
      const result = await plansApi.createFromMessage(conversationId, messageId);
      conversationStore.updateConversationState(conversationId, 'researching');
      return result;
    } catch (err) {
      // Fallback for older backend instances that don't expose /plans/from-message yet.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 404) throw err;

      const conv = conversationStore.activeConversation;
      const source = conv?.id === conversationId
        ? conv.messages.find((m) => m.id === messageId)
        : undefined;
      if (!source || source.role !== 'assistant') throw err;

      const planningPrompt = [
        'Create a structured implementation plan from the following prior analysis.',
        'Return markdown with sections such as Summary, Approach, Steps, Risks, and Effort.',
        '',
        'Prior analysis:',
        source.content,
      ].join('\n');

      await conversationStore.sendMessage(conversationId, planningPrompt);
      conversationStore.updateConversationState(conversationId, 'researching');
      return { accepted: true };
    }
  }

  async function approve(id: string) {
    const conversationStore = useConversationStore();
    const plan = await plansApi.approve(id);
    updateInList(plan);
    if (activePlan.value?.id === id) activePlan.value = plan;
    conversationStore.updateConversationState(plan.conversationId, 'active');
    return plan;
  }

  async function reject(id: string) {
    const conversationStore = useConversationStore();
    const plan = await plansApi.reject(id);
    updateInList(plan);
    if (activePlan.value?.id === id) activePlan.value = plan;
    conversationStore.updateConversationState(plan.conversationId, 'active');
    return plan;
  }

  async function requestChanges(id: string) {
    const conversationStore = useConversationStore();
    const plan = await plansApi.requestChanges(id);
    updateInList(plan);
    if (activePlan.value?.id === id) activePlan.value = plan;
    conversationStore.updateConversationState(plan.conversationId, 'active');
    return plan;
  }

  async function forceCommit(id: string) {
    const conversationStore = useConversationStore();
    const plan = await plansApi.forceCommit(id);
    updateInList(plan);
    if (activePlan.value?.id === id) activePlan.value = plan;
    conversationStore.updateConversationState(plan.conversationId, 'active');
    return plan;
  }

  async function remove(id: string) {
    const conversationStore = useConversationStore();
    const target = plans.value.find((p) => p.id === id) ?? (activePlan.value?.id === id ? activePlan.value : null);
    await plansApi.remove(id);

    plans.value = plans.value.filter((p) => p.id !== id);
    if (activePlan.value?.id === id) {
      activePlan.value = null;
    }

    if (target?.conversationId) {
      conversationStore.updateConversationState(target.conversationId, 'active');
    }
  }

  /** Update a plan from SSE event data */
  function handlePlanUpdate(payload: Record<string, unknown>) {
    const planId = payload.planId as string;
    const status = payload.status as string;

    const idx = plans.value.findIndex((p) => p.id === planId);
    if (idx >= 0) {
      plans.value[idx] = { ...plans.value[idx], status: status as Plan['status'] };
    }
    if (activePlan.value?.id === planId) {
      activePlan.value = { ...activePlan.value, status: status as Plan['status'] };

      if (payload.contradictions) {
        activePlan.value.contradictions = payload.contradictions as Plan['contradictions'];
      }
    }
  }

  function updateInList(plan: Plan) {
    const idx = plans.value.findIndex((p) => p.id === plan.id);
    if (idx >= 0) {
      plans.value[idx] = plan;
    } else {
      plans.value.push(plan);
    }
  }

  return {
    plans,
    activePlan,
    loading,
    fetchPlans,
    fetchPlan,
    fetchByConversation,
    createFromMessage,
    approve,
    reject,
    requestChanges,
    forceCommit,
    remove,
    handlePlanUpdate,
  };
});
