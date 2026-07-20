import { describe, expect, it } from 'vitest';
import type { TaskNode } from './taskTreeTypes';
import { buildTitleMap, validateTaskTree } from './taskTreeValidator';

function makeTaskNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    localId: 'root',
    parentLocalId: null,
    level: 0,
    order: 0,
    titleMode: 'custom',
    title: 'Root task',
    description: 'Description',
    projectId: 'project-1',
    boardId: 'board-1',
    columnId: 'column-1',
    executorUserId: 'user-1',
    deadline: '2026-05-13',
    stickers: { priority: 'high' },
    children: [],
    status: 'draft',
    ...overrides,
  };
}

describe('taskTreeValidator', () => {
  it('rejects missing root task', () => {
    const result = validateTaskTree(null);

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(['missing_root']);
  });

  it('accepts a valid tree with known references', () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      order: 0,
      title: 'Child task',
      columnId: undefined,
      children: [],
    });
    const root = makeTaskNode({ children: [child] });

    const result = validateTaskTree(root, {
      knownProjectIds: new Set(['project-1']),
      knownBoardIds: new Set(['board-1']),
      knownColumnIds: new Set(['column-1']),
      knownUserIds: new Set(['user-1']),
      knownStickerIds: new Set(['priority']),
      knownStateIds: new Set(['high']),
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns critical errors for missing required fields', () => {
    const result = validateTaskTree(
      makeTaskNode({
        title: '',
        projectId: undefined,
        boardId: undefined,
        columnId: undefined,
        executorUserId: undefined,
      }),
      { requireExecutor: true },
    );

    expect(result.errors.map((error) => error.code)).toEqual([
      'missing_title',
      'missing_project',
      'missing_board',
      'missing_root_column',
      'missing_executor',
    ]);
  });

  it('detects broken parent references and level mismatch', () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'missing-parent',
      level: 3,
      title: 'Child task',
      children: [],
    });
    const root = makeTaskNode({ children: [child] });

    const result = validateTaskTree(root);

    expect(result.errors.map((error) => error.code)).toContain('broken_parent_reference');
    expect(result.errors.map((error) => error.code)).toContain('level_mismatch');
  });

  it('returns warnings for optional fields, stale directories and duplicate titles', () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      title: 'Root task',
      description: '',
      deadline: undefined,
      executorUserId: undefined,
      children: [],
    });
    const root = makeTaskNode({ children: [child] });

    const result = validateTaskTree(root, { directoriesAreStale: true });

    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'missing_description',
        'missing_deadline',
        'missing_optional_executor',
        'stale_directories',
        'duplicate_title',
      ]),
    );
  });

  it('builds title map with parent copy modes', () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      titleMode: 'copy_parent_and_extend',
      title: '',
      titleSuffix: 'Final check',
      children: [],
    });
    const titles = buildTitleMap(makeTaskNode({ title: 'Parent', children: [child] }));

    expect(titles.get('child')).toBe('Parent / Final check');
  });

  it('can prefix title with board title', () => {
    const titles = buildTitleMap(
      makeTaskNode({
        title: 'Prepare launch',
        boardTitle: 'Client A',
        includeBoardTitleInTitle: true,
      }),
    );

    expect(titles.get('root')).toBe('Client A / Prepare launch');
  });

  it('adds start date to title in DD.MM format', () => {
    const titles = buildTitleMap(
      makeTaskNode({
        title: 'Prepare launch',
        startDate: '2026-05-13',
      }),
    );

    expect(titles.get('root')).toBe('13.05. Prepare launch');
  });

  it('does not copy parent start date prefix to child title', () => {
    const child = makeTaskNode({
      localId: 'child',
      parentLocalId: 'root',
      level: 1,
      titleMode: 'copy_parent',
      title: '',
      children: [],
    });
    const titles = buildTitleMap(
      makeTaskNode({
        title: 'Prepare launch',
        startDate: '2026-05-13',
        children: [child],
      }),
    );

    expect(titles.get('root')).toBe('13.05. Prepare launch');
    expect(titles.get('child')).toBe('Prepare launch');
  });
});
