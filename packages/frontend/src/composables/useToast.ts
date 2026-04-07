import { ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

let nextId = 0;
const toasts = ref<Toast[]>([]);

export function useToast() {
  function show(message: string, type: Toast['type'] = 'info', duration = 5000) {
    const id = nextId++;
    toasts.value.push({ id, message, type });
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return { toasts, show, dismiss };
}
