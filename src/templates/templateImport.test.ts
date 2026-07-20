import { describe, expect, it } from 'vitest';
import type { DirectoriesCache } from '../storage/directoriesStorage';
import { parseTemplatesImportDocument } from './templateImport';

const directories: DirectoriesCache = {
  projects: [{ id: 'project-1', title: 'Проекты на ТП' }],
  boards: [{ id: 'board-1', projectId: 'project-1', title: 'Dreamx' }],
  columns: [{ id: 'column-1', boardId: 'board-1', title: 'Задачи' }],
  users: [{ id: 'user-1', realName: 'Илья Копытов', email: 'ilya@example.com' }],
  departments: [],
  stickers: [
    {
      id: 'project-sticker',
      name: 'Проект',
      states: [{ id: 'dreamx-state', name: 'Dreamx' }],
    },
    {
      id: 'priority-sticker',
      name: 'Приоритет',
      states: [{ id: 'urgent-state', name: 'Важно сегодня' }],
    },
  ],
  boardStickerConfig: [
    {
      boardId: 'board-1',
      system: [],
      custom: [],
      numeric: [{ id: 'fact-hours', title: 'Факт часов' }],
    },
  ],
  lastSyncAt: '2026-07-16T12:00:00.000Z',
};

function makeExportedTemplate(projectTraitsIncluded = true) {
  return {
    id: 'template-1',
    title: 'Dreamx / Решить X',
    projectTraitsIncluded,
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
    root: {
      titleMode: 'custom',
      title: '16.07. Dreamx / Решить X',
      description: 'Описание',
      project: { name: 'Проекты на ТП' },
      board: { name: 'Dreamx' },
      column: { name: 'Задачи' },
      executor: { name: 'Илья Копытов' },
      includeBoardTitleInTitle: true,
      stickers: [
        { id: 'project-sticker', name: 'Проект', stateId: 'dreamx-state', state: 'Dreamx' },
        { id: 'priority-sticker', name: 'Приоритет', stateId: 'urgent-state', state: 'Важно сегодня' },
      ],
      numericStickers: [{ id: 'fact-hours', name: 'Факт часов', value: '0.5' }],
      deadline: '2026-07-18',
      startDate: '2026-07-16',
      children: [
        {
          titleMode: 'copy_parent_and_extend',
          title: '',
          titleSuffix: 'подзадача',
          description: '',
          stickers: [],
          numericStickers: [],
          children: [],
        },
      ],
    },
  };
}

describe('templateImport', () => {
  it('imports a readable single-template export document', () => {
    const result = parseTemplatesImportDocument(
      {
        format: 'yg-easy-task-template',
        version: 1,
        exportedAt: '2026-07-16T12:00:00.000Z',
        template: makeExportedTemplate(),
      },
      directories,
      '2026-07-16T13:00:00.000Z',
    );

    expect(result.templates).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.templates[0]).toMatchObject({
      title: 'Dreamx / Решить X',
      projectTraitsIncluded: true,
      root: {
        title: 'Dreamx / Решить X',
        projectId: 'project-1',
        boardId: 'board-1',
        columnId: 'column-1',
        executorUserId: 'user-1',
        stickers: {
          'project-sticker': 'dreamx-state',
          'priority-sticker': 'urgent-state',
        },
        numericStickers: {
          'fact-hours': '0.5',
        },
      },
    });
    expect(result.templates[0].root.deadline).toBeUndefined();
    expect(result.templates[0].root.startDate).toBeUndefined();
    expect(result.templates[0].root.children[0].parentLocalId).toBe(result.templates[0].root.localId);
  });

  it('imports several templates from one document', () => {
    const result = parseTemplatesImportDocument(
      {
        format: 'yg-easy-task-templates',
        version: 1,
        exportedAt: '2026-07-16T12:00:00.000Z',
        templates: [makeExportedTemplate(), makeExportedTemplate()],
      },
      directories,
    );

    expect(result.templates).toHaveLength(2);
  });

  it('removes project-specific traits when the exported template asks for it', () => {
    const result = parseTemplatesImportDocument(makeExportedTemplate(false), directories);
    const root = result.templates[0].root;

    expect(root.title).toBe('Решить X');
    expect(root.projectId).toBeUndefined();
    expect(root.boardId).toBeUndefined();
    expect(root.columnId).toBeUndefined();
    expect(root.includeBoardTitleInTitle).toBe(false);
    expect(root.stickers['project-sticker']).toBeUndefined();
    expect(root.stickers['priority-sticker']).toBe('urgent-state');
  });

  it('matches boards and columns inside the matched project and board first', () => {
    const scopedDirectories: DirectoriesCache = {
      ...directories,
      projects: [
        { id: 'project-1', title: 'Проекты на ТП' },
        { id: 'project-2', title: 'Другой проект' },
      ],
      boards: [
        { id: 'wrong-board', projectId: 'project-2', title: 'Dreamx' },
        { id: 'board-1', projectId: 'project-1', title: 'Dreamx' },
      ],
      columns: [
        { id: 'wrong-column', boardId: 'wrong-board', title: 'Задачи' },
        { id: 'column-1', boardId: 'board-1', title: 'Задачи' },
      ],
    };

    const result = parseTemplatesImportDocument(makeExportedTemplate(), scopedDirectories);

    expect(result.unresolvedCount).toBe(0);
    expect(result.templates[0].root.boardId).toBe('board-1');
    expect(result.templates[0].root.columnId).toBe('column-1');
  });
});
