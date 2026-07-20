import { describe, expect, it } from 'vitest';
import { areDirectoriesStale, filterBoardsByProject, filterColumnsByBoard } from './directoriesStorage';

describe('directoriesStorage filters', () => {
  it('filters boards by project id', () => {
    const boards = [
      { id: 'board-a', projectId: 'project-1', title: 'A' },
      { id: 'board-b', projectId: 'project-2', title: 'B' },
      { id: 'board-c', projectId: 'project-1', title: 'C' },
    ];

    expect(filterBoardsByProject(boards, 'project-1')).toHaveLength(2);
    expect(filterBoardsByProject(boards, 'project-2')).toEqual([
      { id: 'board-b', projectId: 'project-2', title: 'B' },
    ]);
  });

  it('falls back to unlinked boards when selected project has no linked boards', () => {
    const boards = [
      { id: 'board-a', title: 'A' },
      { id: 'board-b', title: 'B' },
    ];

    expect(filterBoardsByProject(boards, 'project-1')).toEqual(boards);
  });

  it('does not fall back to all boards when boards are linked to other projects', () => {
    const boards = [
      { id: 'board-a', projectId: 'project-2', title: 'A' },
      { id: 'board-b', projectId: 'project-3', title: 'B' },
    ];

    expect(filterBoardsByProject(boards, 'project-1')).toEqual([]);
  });

  it('filters columns by board id', () => {
    const columns = [
      { id: 'column-a', boardId: 'board-1', title: 'A' },
      { id: 'column-b', boardId: 'board-2', title: 'B' },
      { id: 'column-c', boardId: 'board-1', title: 'C' },
    ];

    expect(filterColumnsByBoard(columns, 'board-1')).toHaveLength(2);
    expect(filterColumnsByBoard(columns, 'missing')).toEqual([]);
  });

  it('detects directories older than 24 hours', () => {
    const now = new Date('2026-05-12T12:00:00.000Z');

    expect(areDirectoriesStale('2026-05-11T11:59:59.000Z', now)).toBe(true);
    expect(areDirectoriesStale('2026-05-11T12:00:01.000Z', now)).toBe(false);
    expect(areDirectoriesStale(null, now)).toBe(false);
  });
});
