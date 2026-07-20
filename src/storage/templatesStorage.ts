import type { TaskNode } from '../task-tree/taskTreeTypes';
import { prepareTaskTreeTemplateRoot } from '../templates/templateNormalizer';
import { readStorageValue, writeStorageValue } from './storageClient';

export const TEMPLATES_STORAGE_KEY = 'ygEasyTemplates';
export const TASK_TREE_TEMPLATE_FORMAT = 'yg-easy-task-template';
export const TASK_TREE_TEMPLATE_VERSION = 1;

export type TaskTreeTemplate = {
  format: typeof TASK_TREE_TEMPLATE_FORMAT;
  version: typeof TASK_TREE_TEMPLATE_VERSION;
  id: string;
  title: string;
  projectTraitsIncluded: boolean;
  root: TaskNode;
  createdAt: string;
  updatedAt: string;
};

export async function readTemplates(): Promise<TaskTreeTemplate[]> {
  const templates = await readStorageValue<Array<Partial<TaskTreeTemplate>>>(TEMPLATES_STORAGE_KEY, []);
  return templates.filter(isReadableTemplate).map(normalizeTemplate);
}

export async function writeTemplates(templates: TaskTreeTemplate[]): Promise<void> {
  await writeStorageValue(TEMPLATES_STORAGE_KEY, templates.map(normalizeTemplate));
}

export async function upsertTemplate(template: TaskTreeTemplate): Promise<TaskTreeTemplate[]> {
  const templates = await readTemplates();
  const index = templates.findIndex((item) => item.id === template.id);
  const nextTemplates =
    index >= 0
      ? templates.map((item) => (item.id === template.id ? template : item))
      : [template, ...templates];

  await writeTemplates(nextTemplates);
  return nextTemplates;
}

export async function deleteTemplate(templateId: string): Promise<TaskTreeTemplate[]> {
  const nextTemplates = (await readTemplates()).filter((template) => template.id !== templateId);
  await writeTemplates(nextTemplates);
  return nextTemplates;
}

function normalizeTemplate(template: Partial<TaskTreeTemplate>): TaskTreeTemplate {
  const projectTraitsIncluded = template.projectTraitsIncluded ?? true;
  const now = new Date().toISOString();

  return {
    format: TASK_TREE_TEMPLATE_FORMAT,
    version: TASK_TREE_TEMPLATE_VERSION,
    id: template.id ?? `template-${Date.now().toString(36)}`,
    title: template.title ?? 'Новый шаблон',
    projectTraitsIncluded,
    root: prepareTaskTreeTemplateRoot(template.root as TaskNode, {
      includeProjectTraits: projectTraitsIncluded,
    }),
    createdAt: template.createdAt ?? now,
    updatedAt: template.updatedAt ?? template.createdAt ?? now,
  };
}

function isReadableTemplate(template: Partial<TaskTreeTemplate>): template is Partial<TaskTreeTemplate> & { root: TaskNode } {
  return typeof template === 'object' && template !== null && Boolean(template.root);
}
