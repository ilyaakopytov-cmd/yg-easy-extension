import type { CreatedTask, CreateTaskPayload } from '../api/tasksApi';
import { mapTaskNodeToPayload } from './taskTreeMapper';
import type { TaskNode } from './taskTreeTypes';
import {
  buildTitleMap,
  validateTaskTree,
  type TaskTreeValidationContext,
  type TaskTreeValidationResult,
} from './taskTreeValidator';

export type CreateTaskFn = (payload: CreateTaskPayload) => Promise<CreatedTask>;

export type CreatedTaskNodeResult = {
  localId: string;
  title: string;
  yougileTaskId: string;
  payload?: CreateTaskPayload;
  deadlineUpdate?: CreatedTask['deadlineUpdate'];
};

export type TaskTreeCreationResult = {
  rootTaskId: string;
  createdTasks: CreatedTaskNodeResult[];
  validation: TaskTreeValidationResult;
};

export type TaskTreeCreationStatusItem = {
  localId: string;
  title: string;
  status: TaskNode['status'];
  yougileTaskId?: string;
  error?: string;
};

export type TaskTreeCreationSummary = {
  created: number;
  errors: number;
  items: TaskTreeCreationStatusItem[];
};

export async function createTaskTree(
  root: TaskNode,
  createTask: CreateTaskFn,
  validationContext: TaskTreeValidationContext = {},
): Promise<TaskTreeCreationResult> {
  const validation = validateTaskTree(root, validationContext);

  if (!validation.isValid) {
    throw new TaskTreeValidationError(validation);
  }

  const titleByLocalId = buildTitleMap(root);
  const createdTasks: CreatedTaskNodeResult[] = [];
  const rootTaskId = await createTaskNode(root, true, createTask, {
    titleByLocalId,
    createdTasks,
  });

  return {
    rootTaskId,
    createdTasks,
    validation,
  };
}

export async function createTaskNode(
  node: TaskNode,
  isRoot: boolean,
  createTask: CreateTaskFn,
  context: {
    titleByLocalId?: Map<string, string>;
    createdTasks?: CreatedTaskNodeResult[];
  } = {},
): Promise<string> {
  const childIds: string[] = [];

  for (const child of node.children) {
    const childId = await createTaskNode(child, false, createTask, context);
    childIds.push(childId);
  }

  const title = context.titleByLocalId?.get(node.localId) ?? node.title;

  if (node.yougileTaskId) {
    context.createdTasks?.push({
      localId: node.localId,
      title,
      yougileTaskId: node.yougileTaskId,
    });
    return node.yougileTaskId;
  }

  node.status = 'creating';
  const payload = mapTaskNodeToPayload(node, childIds, isRoot, title);

  try {
    const created = await createTask(payload);
    node.yougileTaskId = created.id;
    node.status = 'created';
    context.createdTasks?.push({
      localId: node.localId,
      title,
      yougileTaskId: created.id,
      payload,
      deadlineUpdate: created.deadlineUpdate,
    });
  } catch (error) {
    node.status = 'error';
    node.error = getCreationErrorMessage(error);
    throw error;
  }

  return node.yougileTaskId;
}

export function summarizeTaskTreeCreation(root: TaskNode): TaskTreeCreationSummary {
  const titleByLocalId = buildTitleMap(root);
  const items = collectCreationStatusItems(root, titleByLocalId);

  return {
    created: items.filter((item) => item.status === 'created').length,
    errors: items.filter((item) => item.status === 'error').length,
    items,
  };
}

export class TaskTreeValidationError extends Error {
  constructor(public readonly validation: TaskTreeValidationResult) {
    super('Дерево задач содержит критичные ошибки и не может быть создано.');
  }
}

function collectCreationStatusItems(root: TaskNode, titleByLocalId: Map<string, string>): TaskTreeCreationStatusItem[] {
  return [
    {
      localId: root.localId,
      title: titleByLocalId.get(root.localId) ?? root.title,
      status: root.status,
      yougileTaskId: root.yougileTaskId,
      error: root.error,
    },
    ...root.children.flatMap((child) => collectCreationStatusItems(child, titleByLocalId)),
  ];
}

function getCreationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return 'Неизвестная ошибка создания задачи.';
}
