import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBoardStickerConfig,
  buildDirectoriesCache,
  loadBoardsByProject,
  loadColumnsByBoard,
  readAllListPages,
} from './directoriesApi';
import { yougileRequest } from './yougileClient';

vi.mock('./yougileClient', () => ({
  yougileRequest: vi.fn(),
}));

describe('directoriesApi', () => {
  beforeEach(() => {
    vi.mocked(yougileRequest).mockReset();
  });

  it('normalizes list responses into directories cache', () => {
    const cache = buildDirectoriesCache({
      projects: { content: [{ id: 'project-1', name: 'Project name' }] },
      boards: {
        content: [{ id: 'board-1', projectId: 'project-1', name: 'Board name', stickers: { deadline: true } }],
      },
      columns: { content: [{ id: 'column-1', boardId: 'board-1', name: 'Column name' }] },
      users: { content: [{ id: 'user-1', realName: 'User' }] },
      departments: { content: [{ id: 'department-1', name: 'Department' }] },
      stickers: { content: [{ id: 'sticker-1', name: 'Priority', states: [] }] },
      now: new Date('2026-05-12T10:00:00.000Z'),
    });

    expect(cache.projects[0].title).toBe('Project name');
    expect(cache.boards[0].title).toBe('Board name');
    expect(cache.columns[0].title).toBe('Column name');
    expect(cache.departments[0].title).toBe('Department');
    expect(cache.lastSyncAt).toBe('2026-05-12T10:00:00.000Z');
  });

  it('splits board stickers into system, custom state stickers and numeric fields', () => {
    const config = buildBoardStickerConfig(
      [
        {
          id: 'board-1',
          projectId: 'project-1',
          title: 'Board',
          stickers: {
            deadline: true,
            assignee: true,
            repeat: false,
            custom: {
              'string-sticker': true,
              '6421ea8e-e490-4b12-a09c-0a571dc5780b': true,
            },
          },
        },
      ],
      [{ id: 'string-sticker', name: 'Priority', states: [] }],
    );

    expect(config).toEqual([
      {
        boardId: 'board-1',
        system: ['deadline', 'assignee'],
        custom: ['string-sticker'],
        numeric: [
          {
            id: '6421ea8e-e490-4b12-a09c-0a571dc5780b',
            title: 'План Сегодня',
          },
        ],
      },
    ]);
  });

  it('names known numeric custom stickers from board config ids', () => {
    const config = buildBoardStickerConfig(
      [
        {
          id: 'board-1',
          projectId: 'project-1',
          title: 'Board',
          stickers: {
            custom: {
              '0886f234-c572-42fb-8ef0-810320b7897d': true,
              '08a43040-64a0-425f-a98b-df23f74fdd00': true,
              '8a4ab364-b130-4cdb-a814-801a3a4176a4': true,
              'e0d55a08-d708-427a-900d-fa0aeaf6be4d': true,
            },
          },
        },
      ],
      [],
    );

    expect(config[0].numeric).toEqual([
      {
        id: '0886f234-c572-42fb-8ef0-810320b7897d',
        title: 'План Сегодня',
      },
      {
        id: '08a43040-64a0-425f-a98b-df23f74fdd00',
        title: 'Общий план',
      },
      {
        id: '8a4ab364-b130-4cdb-a814-801a3a4176a4',
        title: 'Регулярная задача',
      },
      {
        id: 'e0d55a08-d708-427a-900d-fa0aeaf6be4d',
        title: 'План ОВК',
      },
    ]);
  });

  it('uses scoped board project ids when API provides project-filtered board sets', () => {
    const cache = buildDirectoriesCache({
      projects: { content: [{ id: 'project-1', name: 'Project name' }] },
      boards: { content: [{ id: 'board-1', name: 'Board name' }] },
      columns: { content: [] },
      users: { content: [] },
      departments: { content: [] },
      stickers: { content: [] },
      boardProjectIds: new Map([['board-1', 'project-1']]),
      now: new Date('2026-05-12T10:00:00.000Z'),
    });

    expect(cache.boards[0].projectId).toBe('project-1');
  });

  it('does not treat parentId as a project link', () => {
    const boardFromExternalApi = { id: 'board-1', name: 'Board name', parentId: 'not-a-project' };

    const cache = buildDirectoriesCache({
      projects: { content: [{ id: 'project-1', name: 'Project name' }] },
      boards: { content: [boardFromExternalApi] },
      columns: { content: [] },
      users: { content: [] },
      departments: { content: [] },
      stickers: { content: [] },
      now: new Date('2026-05-12T10:00:00.000Z'),
    });

    expect(cache.boards[0].projectId).toBeUndefined();
  });

  it('collects boards from project-scoped API responses', async () => {
    const result = await loadBoardsByProject(
      [
        { id: 'project-1', title: 'Project 1' },
        { id: 'project-2', title: 'Project 2' },
      ],
      async (projectId) => ({
        content:
          projectId === 'project-1'
            ? [{ id: 'board-1', title: 'Board 1' }]
            : [{ id: 'board-2', title: 'Board 2' }],
      }),
    );

    expect(result?.boards.map((board) => board.id).sort()).toEqual(['board-1', 'board-2']);
    expect(result?.projectIdsByBoardId.get('board-1')).toBe('project-1');
    expect(result?.projectIdsByBoardId.get('board-2')).toBe('project-2');
  });

  it('collects columns from board-scoped API responses', async () => {
    const result = await loadColumnsByBoard(
      [
        { id: 'board-1', title: 'Board 1' },
        { id: 'board-2', title: 'Board 2' },
      ],
      async (boardId) => ({
        content:
          boardId === 'board-1'
            ? [{ id: 'column-1', boardId: 'board-1', title: 'Column 1' }]
            : [{ id: 'column-2', boardId: 'board-2', title: 'Column 2' }],
      }),
    );

    expect(result?.map((column) => column.id).sort()).toEqual(['column-1', 'column-2']);
  });

  it('loads all list pages while API reports next page', async () => {
    vi.mocked(yougileRequest)
      .mockResolvedValueOnce({
        content: [{ id: 'board-1' }],
        paging: { limit: 1, offset: 0, next: true },
      })
      .mockResolvedValueOnce({
        content: [{ id: 'board-2' }],
        paging: { limit: 1, offset: 1, next: false },
      });

    await expect(readAllListPages<{ id: string }>('/boards?projectId=project-1', 'token', 1)).resolves.toEqual({
      content: [{ id: 'board-1' }, { id: 'board-2' }],
    });
    expect(yougileRequest).toHaveBeenNthCalledWith(1, '/boards?projectId=project-1&limit=1&offset=0', 'token');
    expect(yougileRequest).toHaveBeenNthCalledWith(2, '/boards?projectId=project-1&limit=1&offset=1', 'token');
  });

  it('retries transient list page errors', async () => {
    vi.useFakeTimers();
    vi.mocked(yougileRequest)
      .mockRejectedValueOnce({ status: 502, message: 'Bad gateway' })
      .mockResolvedValueOnce({
        content: [{ id: 'board-1' }],
        paging: { limit: 1, offset: 0, next: false },
    });

    const resultPromise = readAllListPages<{ id: string }>('/boards', 'token', 1);
    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toEqual({ content: [{ id: 'board-1' }] });
    expect(yougileRequest).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
