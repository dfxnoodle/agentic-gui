import { defineStore } from 'pinia';
import { ref } from 'vue';
import { projectsApi } from '../api/projects.api';
import type { Project, CLIProvider } from '@agentic-gui/shared';

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([]);
  const activeProject = ref<Project | null>(null);
  const loading = ref(false);

  async function fetchProjects() {
    loading.value = true;
    try {
      projects.value = await projectsApi.list();
      if (projects.value.length > 0 && !activeProject.value) {
        activeProject.value = projects.value[0];
      }
    } finally {
      loading.value = false;
    }
  }

  function setActiveProject(project: Project) {
    activeProject.value = project;
  }

  async function createProject(payload: { name: string; rootPath: string; cliProvider: CLIProvider }) {
    const project = await projectsApi.create(payload);
    projects.value.push(project);
    if (!activeProject.value) activeProject.value = project;
    return project;
  }

  async function deleteProject(id: string) {
    await projectsApi.remove(id);
    projects.value = projects.value.filter((project) => project.id !== id);

    if (activeProject.value?.id === id) {
      activeProject.value = projects.value[0] ?? null;
    }
  }

  return { projects, activeProject, loading, fetchProjects, setActiveProject, createProject, deleteProject };
});
