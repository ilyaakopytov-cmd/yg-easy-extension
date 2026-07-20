import { describe, expect, it } from 'vitest';
import type { CreateTaskPayload } from '../api/tasksApi';
import type { TaskNode } from './taskTreeTypes';
import { createTaskTree, summarizeTaskTreeCreation, TaskTreeValidationError } from './taskTreeCreator';

function makeTaskNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    localId: 'root',
    parentLocalId: null,
    level: 0,
    order: 0,
    titleMode: 'custom',
    title: 'Root',
    description: 'Description',
    projectId: 'project-1',
    boardId: 'board-1',
    columnId: 'column-1',
    executorUserId: 'user-1',
    deadline: '2026-05-13',
    stickers: {},
    children: [],
    status: 'draft',
    ...overrides,
  };
}

function createRecorder() {
  const payloads: CreateTaskPayload[] = [];

  return {
    payloads,
    createTask: async (payload: CreateTaskPayload) => {
      payloads.push(payload);
      return {
        id: `task-${payloads.length}`,
        title: payload.title,
      };
    },
  };
}

describe('taskTreeCreator', () => {
  it('creates a two-level matryoshka bottom-up', async () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      title: 'Child',
      columnId: undefined,
      children: [],
    });
    const root = makeTaskNode({ children: [child] });
    const recorder = createRecorder();

    const result = await createTaskTree(root, recorder.createTask);

    expect(result.rootTaskId).toBe('task-2');
    expect(recorder.payloads).toEqual([
      expect.objectContaining({ title: 'Child', columnId: undefined, subtasks: undefined }),
      expect.objectContaining({ title: 'Root', columnId: 'column-1', subtasks: ['task-1'] }),
    ]);
    expect(child.yougileTaskId).toBe('task-1');
    expect(root.yougileTaskId).toBe('task-2');
  });

  it('creates a three-level tree bottom-up', async () => {
    const leaf = makeTaskNode({
      localId: 'leaf',
      parentLocalId: 'middle',
      level: 2,
      title: 'Leaf',
      columnId: undefined,
    });
    const middle = makeTaskNode({
      localId: 'middle',
      parentLocalId: 'root',
      level: 1,
      title: 'Middle',
      columnId: undefined,
      children: [leaf],
    });
    const root = makeTaskNode({ children: [middle] });
    const recorder = createRecorder();

    await createTaskTree(root, recorder.createTask);

    expect(recorder.payloads.map((payload) => payload.title)).toEqual(['Leaf', 'Middle', 'Root']);
    expect(recorder.payloads.map((payload) => payload.columnId)).toEqual([undefined, undefined, 'column-1']);
    expect(recorder.payloads[1].subtasks).toEqual(['task-1']);
    expect(recorder.payloads[2].subtasks).toEqual(['task-2']);
  });

  it('creates a branched tree before the root task', async () => {
    const a1 = makeTaskNode({ localId: 'a1', parentLocalId: 'a', level: 2, title: 'A1', columnId: undefined });
    const b1 = makeTaskNode({ localId: 'b1', parentLocalId: 'b', level: 2, title: 'B1', columnId: undefined });
    const a = makeTaskNode({ localId: 'a', parentLocalId: 'root', level: 1, title: 'A', columnId: undefined, children: [a1] });
    const b = makeTaskNode({ localId: 'b', parentLocalId: 'root', level: 1, title: 'B', columnId: undefined, children: [b1] });
    const root = makeTaskNode({ children: [a, b] });
    const recorder = createRecorder();

    await createTaskTree(root, recorder.createTask);

    expect(recorder.payloads.map((payload) => payload.title)).toEqual(['A1', 'A', 'B1', 'B', 'Root']);
    expect(recorder.payloads[4]).toEqual(expect.objectContaining({ columnId: 'column-1', subtasks: ['task-2', 'task-4'] }));
  });

  it('uses copied parent title and includes numeric stickers', async () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      titleMode: 'copy_parent_and_extend',
      title: '',
      titleSuffix: 'Final check',
      stickers: { priority: 'high' },
      numericStickers: { hours: '1.5' },
      columnId: undefined,
    });
    const root = makeTaskNode({ title: 'Parent', children: [child] });
    const recorder = createRecorder();

    await createTaskTree(root, recorder.createTask);

    expect(recorder.payloads[0]).toEqual(
      expect.objectContaining({
        title: 'Parent / Final check',
        stickers: { priority: 'high', hours: '1.5' },
      }),
    );
  });

  it('does not create tasks when validation fails', async () => {
    const recorder = createRecorder();

    await expect(createTaskTree(makeTaskNode({ title: '' }), recorder.createTask)).rejects.toBeInstanceOf(
      TaskTreeValidationError,
    );
    expect(recorder.payloads).toEqual([]);
  });

  it('does not post a node that already has yougileTaskId during retry', async () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      title: 'Child',
      columnId: undefined,
      yougileTaskId: 'existing-child',
    });
    const root = makeTaskNode({ children: [child] });
    const recorder = createRecorder();

    await createTaskTree(root, recorder.createTask);

    expect(recorder.payloads).toEqual([
      expect.objectContaining({
        title: 'Root',
        columnId: 'column-1',
        subtasks: ['existing-child'],
      }),
    ]);
  });

  it('marks failed node and returns partial creation summary', async () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      title: 'Child',
      columnId: undefined,
    });
    const root = makeTaskNode({ children: [child] });

    await expect(
      createTaskTree(root, async (payload) => {
        if (payload.title === 'Root') {
          throw new Error('Root failed');
        }

        return { id: 'child-created', title: payload.title };
      }),
    ).rejects.toThrow('Root failed');

    expect(summarizeTaskTreeCreation(root)).toEqual({
      created: 1,
      errors: 1,
      items: [
        {
          localId: 'root',
          title: 'Root',
          status: 'error',
          yougileTaskId: undefined,
          error: 'Root failed',
        },
        {
          localId: 'child',
          title: 'Child',
          status: 'created',
          yougileTaskId: 'child-created',
          error: undefined,
        },
      ],
    });
  });
});
