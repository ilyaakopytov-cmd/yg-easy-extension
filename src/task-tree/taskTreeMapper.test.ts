import { describe, expect, it } from 'vitest';
import type { TaskNode } from './taskTreeTypes';
import { mapTaskNodeToPayload } from './taskTreeMapper';

function makeTaskNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    localId: 'root',
    parentLocalId: null,
    level: 0,
    order: 0,
    titleMode: 'custom',
    title: 'Task',
    description: '',
    projectId: 'project-1',
    boardId: 'board-1',
    boardTitle: 'Client Board',
    columnId: 'column-1',
    stickers: {},
    children: [],
    status: 'draft',
    ...overrides,
  };
}

describe('taskTreeMapper', () => {
  it('adds board title to payload title when requested', () => {
    const payload = mapTaskNodeToPayload(
      makeTaskNode({
        includeBoardTitleInTitle: true,
      }),
      [],
      true,
      'Task',
    );

    expect(payload.title).toBe('Client Board / Task');
  });

  it('does not duplicate board title in payload title', () => {
    const payload = mapTaskNodeToPayload(
      makeTaskNode({
        includeBoardTitleInTitle: true,
      }),
      [],
      true,
      'Client Board / Task',
    );

    expect(payload.title).toBe('Client Board / Task');
  });

  it('maps deadline date to YouGile deadline payload', () => {
    const payload = mapTaskNodeToPayload(
      makeTaskNode({
        deadline: '2026-05-15',
      }),
      [],
      true,
    );

    expect(payload.deadline).toEqual({
      deadline: new Date(2026, 4, 15, 12).getTime(),
      startDate: 0,
      withTime: false,
    });
  });
});
