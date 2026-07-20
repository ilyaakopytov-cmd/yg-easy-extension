import { describe, expect, it, vi } from 'vitest';
import { createTask } from './tasksApi';
import { yougileRequest } from './yougileClient';

vi.mock('./yougileClient', () => ({
  yougileRequest: vi.fn(),
}));

describe('tasksApi', () => {
  it('updates task deadline after creating a task with deadline', async () => {
    const mockedRequest = vi.mocked(yougileRequest);
    const deadline = {
      deadline: new Date(2026, 4, 20, 12).getTime(),
      startDate: 0,
      withTime: false,
    };

    mockedRequest.mockResolvedValueOnce({ id: 'task-1', title: 'Task' });
    mockedRequest.mockResolvedValueOnce({});

    await createTask('api-key', {
      title: 'Task',
      columnId: 'column-1',
      deadline,
    });

    expect(mockedRequest).toHaveBeenNthCalledWith(1, '/tasks', 'api-key', {
      method: 'POST',
      body: {
        title: 'Task',
        columnId: 'column-1',
        deadline,
      },
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, '/tasks/task-1', 'api-key', {
      method: 'PUT',
      body: {
        deadline,
      },
    });
  });
});
