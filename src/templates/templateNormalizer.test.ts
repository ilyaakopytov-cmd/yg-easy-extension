import { describe, expect, it } from 'vitest';
import type { TaskNode } from '../task-tree/taskTreeTypes';
import { prepareTaskTreeTemplateRoot } from './templateNormalizer';

function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    localId: 'root',
    parentLocalId: null,
    level: 0,
    order: 0,
    titleMode: 'custom',
    title: '15.07. Client Board / Root task',
    description: 'Description',
    projectId: 'project-1',
    projectTitle: 'Project One',
    boardId: 'board-1',
    boardTitle: 'Client Board',
    columnId: 'column-1',
    columnTitle: 'Tasks',
    includeBoardTitleInTitle: true,
    executorUserId: 'user-1',
    deadline: '2026-07-20',
    startDate: '2026-07-15',
    hasStartDateFlag: true,
    stickers: {
      projectSticker: 'client-state',
      priority: 'high',
    },
    numericStickers: {
      plan: '0.5',
    },
    yougileTaskId: 'task-1',
    status: 'created',
    error: 'Old error',
    children: [],
    ...overrides,
  };
}

describe('templateNormalizer', () => {
  it('removes situational dates and creation state from templates', () => {
    const child = makeNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      order: 0,
      title: '15.07. Child task',
      children: [],
    });
    const root = makeNode({ children: [child] });

    const templateRoot = prepareTaskTreeTemplateRoot(root, {
      includeProjectTraits: true,
      projectStickerId: 'projectSticker',
    });

    expect(templateRoot).toMatchObject({
      localId: 'root',
      parentLocalId: null,
      level: 0,
      order: 0,
      title: 'Client Board / Root task',
      deadline: undefined,
      startDate: undefined,
      hasStartDateFlag: undefined,
      yougileTaskId: undefined,
      status: 'draft',
      error: undefined,
    });
    expect(templateRoot.children[0]).toMatchObject({
      parentLocalId: 'root',
      level: 1,
      order: 0,
      title: 'Child task',
      deadline: undefined,
      startDate: undefined,
      status: 'draft',
    });
  });

  it('can strip project-specific traits from template tree', () => {
    const templateRoot = prepareTaskTreeTemplateRoot(makeNode(), {
      includeProjectTraits: false,
      projectStickerId: 'projectSticker',
    });

    expect(templateRoot).toMatchObject({
      title: 'Root task',
      projectId: undefined,
      projectTitle: undefined,
      boardId: undefined,
      boardTitle: undefined,
      columnId: undefined,
      columnTitle: undefined,
      includeBoardTitleInTitle: false,
      stickers: {
        priority: 'high',
      },
      numericStickers: {
        plan: '0.5',
      },
    });
  });
});
