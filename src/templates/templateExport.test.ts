import { describe, expect, it } from 'vitest';
import type { DirectoriesCache } from '../storage/directoriesStorage';
import {
  TASK_TREE_TEMPLATE_FORMAT,
  TASK_TREE_TEMPLATE_VERSION,
  type TaskTreeTemplate,
} from '../storage/templatesStorage';
import type { TaskNode } from '../task-tree/taskTreeTypes';
import { buildSingleTemplateExport, buildTemplatesExport } from './templateExport';

const directories: DirectoriesCache = {
  projects: [{ id: 'project-1', title: 'Project One' }],
  boards: [{ id: 'board-1', title: 'Board One', projectId: 'project-1' }],
  columns: [{ id: 'column-1', title: 'Tasks', boardId: 'board-1' }],
  users: [{ id: 'user-1', realName: 'User One', email: 'user@example.com' }],
  departments: [],
  stickers: [
    {
      id: 'priority',
      name: 'Приоритет',
      states: [{ id: 'high', name: 'Важно сегодня' }],
    },
  ],
  boardStickerConfig: [
    {
      boardId: 'board-1',
      system: [],
      custom: ['priority'],
      numeric: [{ id: 'plan', title: 'План Сегодня' }],
    },
  ],
  lastSyncAt: '2026-07-16T00:00:00.000Z',
};

function makeTemplate(): TaskTreeTemplate {
  return {
    format: TASK_TREE_TEMPLATE_FORMAT,
    version: TASK_TREE_TEMPLATE_VERSION,
    id: 'template-1',
    title: 'Template One',
    projectTraitsIncluded: true,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    root: makeNode(),
  };
}

function makeNode(): TaskNode {
  return {
    localId: 'root',
    parentLocalId: null,
    level: 0,
    order: 0,
    titleMode: 'custom',
    title: 'Root',
    description: 'Description',
    projectId: 'project-1',
    projectTitle: 'Project One',
    boardId: 'board-1',
    boardTitle: 'Board One',
    columnId: 'column-1',
    columnTitle: 'Tasks',
    executorUserId: 'user-1',
    executorName: 'User One',
    stickers: { priority: 'high' },
    numericStickers: { plan: '0.5' },
    children: [],
    status: 'draft',
  };
}

describe('templateExport', () => {
  it('builds a readable single-template export document', () => {
    const document = buildSingleTemplateExport(makeTemplate(), directories, '2026-07-16T12:00:00.000Z');

    expect(document).toEqual({
      format: 'yg-easy-task-template',
      version: 1,
      exportedAt: '2026-07-16T12:00:00.000Z',
      template: expect.objectContaining({
        id: 'template-1',
        title: 'Template One',
        root: expect.objectContaining({
          title: 'Root',
          project: { id: 'project-1', name: 'Project One' },
          board: { id: 'board-1', name: 'Board One' },
          column: { id: 'column-1', name: 'Tasks' },
          executor: { id: 'user-1', name: 'User One' },
          stickers: [{ id: 'priority', name: 'Приоритет', stateId: 'high', state: 'Важно сегодня' }],
          numericStickers: [{ id: 'plan', name: 'План Сегодня', value: '0.5' }],
          children: [],
        }),
      }),
    });
  });

  it('builds a multi-template export document', () => {
    const document = buildTemplatesExport([makeTemplate()], directories, '2026-07-16T12:00:00.000Z');

    expect(document.format).toBe('yg-easy-task-templates');
    expect(document.templates).toHaveLength(1);
  });
});
