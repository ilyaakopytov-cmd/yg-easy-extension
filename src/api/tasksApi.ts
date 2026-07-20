import { yougileRequest } from './yougileClient';

export type CreateTaskPayload = {
  title: string;
  description?: string;
  columnId?: string;
  assigned?: string[];
  deadline?: {
    deadline: number;
    startDate: number;
    withTime: boolean;
  };
  stickers?: Record<string, string>;
  subtasks?: string[];
};

export type CreatedTask = {
  id: string;
  title: string;
  deadlineUpdate?: DeadlineUpdateResult;
};

export type DeadlineUpdateResult = {
  requested: boolean;
  ok: boolean;
  error?: string;
};

export async function createTask(apiKey: string, payload: CreateTaskPayload): Promise<CreatedTask> {
  const createdTask = await yougileRequest<CreatedTask>('/tasks', apiKey, {
    method: 'POST',
    body: payload,
  });

  if (payload.deadline) {
    await updateTaskDeadline(apiKey, createdTask.id, payload.deadline);

    return {
      ...createdTask,
      deadlineUpdate: {
        requested: true,
        ok: true,
      },
    };
  }

  return {
    ...createdTask,
    deadlineUpdate: {
      requested: false,
      ok: true,
    },
  };
}

export async function updateTaskDeadline(
  apiKey: string,
  taskId: string,
  deadline: NonNullable<CreateTaskPayload['deadline']>,
): Promise<void> {
  await yougileRequest<unknown>(`/tasks/${taskId}`, apiKey, {
    method: 'PUT',
    body: {
      deadline,
    },
  });
}
