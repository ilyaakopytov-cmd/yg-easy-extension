export const DIRECTORIES_STORAGE_KEY = 'ygEasyDirectories';

import type { YouGileBoard } from '../api/boardsApi';
import type { YouGileColumn } from '../api/columnsApi';
import type { YouGileDepartment } from '../api/departmentsApi';
import type { YouGileProject } from '../api/projectsApi';
import type { YouGileStringSticker } from '../api/stickersApi';
import type { YouGileUser } from '../api/usersApi';
import { readStorageValue, writeStorageValue } from './storageClient';

export type BoardStickerConfig = {
  boardId: string;
  system: string[];
  custom: string[];
  numeric: Array<{
    id: string;
    title: string;
  }>;
};

export type DirectoriesCache = {
  projects: YouGileProject[];
  boards: YouGileBoard[];
  columns: YouGileColumn[];
  users: YouGileUser[];
  departments: YouGileDepartment[];
  stickers: YouGileStringSticker[];
  boardStickerConfig: BoardStickerConfig[];
  lastSyncAt: string | null;
};

export const EMPTY_DIRECTORIES_CACHE: DirectoriesCache = {
  projects: [],
  boards: [],
  columns: [],
  users: [],
  departments: [],
  stickers: [],
  boardStickerConfig: [],
  lastSyncAt: null,
};

export function filterBoardsByProject(boards: YouGileBoard[], projectId: string): YouGileBoard[] {
  if (!projectId) {
    return [];
  }

  const linkedBoards = boards.filter((board) => board.projectId === projectId);

  if (linkedBoards.length) {
    return linkedBoards;
  }

  const hasProjectLinks = boards.some((board) => Boolean(board.projectId));

  return hasProjectLinks ? [] : boards;
}

export function filterColumnsByBoard(columns: YouGileColumn[], boardId: string): YouGileColumn[] {
  return columns.filter((column) => column.boardId === boardId);
}

export function areDirectoriesStale(lastSyncAt: string | null, now = new Date()): boolean {
  if (!lastSyncAt) {
    return false;
  }

  const lastSyncTime = new Date(lastSyncAt).getTime();

  if (Number.isNaN(lastSyncTime)) {
    return true;
  }

  return now.getTime() - lastSyncTime > 24 * 60 * 60 * 1000;
}

export async function readDirectoriesCache(): Promise<DirectoriesCache> {
  return normalizeDirectoriesCache(await readStorageValue(DIRECTORIES_STORAGE_KEY, EMPTY_DIRECTORIES_CACHE));
}

export async function writeDirectoriesCache(cache: DirectoriesCache): Promise<void> {
  await writeStorageValue(DIRECTORIES_STORAGE_KEY, cache);
}

function normalizeDirectoriesCache(value: unknown): DirectoriesCache {
  const candidate = typeof value === 'object' && value !== null ? (value as Partial<DirectoriesCache>) : {};

  return {
    projects: Array.isArray(candidate.projects) ? candidate.projects : [],
    boards: Array.isArray(candidate.boards)
      ? candidate.boards.map((board) => {
          const rawBoard = board as YouGileBoard & {
            projectID?: string;
            project_id?: string;
            project?: string | { id?: string };
            projects?: Array<string | { id?: string }>;
            projectIds?: string[];
            project_ids?: string[];
          };

          return {
            ...board,
            projectId: getBoardProjectId(rawBoard),
          };
        })
      : [],
    columns: Array.isArray(candidate.columns) ? candidate.columns : [],
    users: Array.isArray(candidate.users) ? candidate.users : [],
    departments: Array.isArray(candidate.departments) ? candidate.departments : [],
    stickers: Array.isArray(candidate.stickers)
      ? candidate.stickers.map((sticker) => ({
          ...sticker,
          states: Array.isArray(sticker.states) ? sticker.states : [],
        }))
      : [],
    boardStickerConfig: Array.isArray(candidate.boardStickerConfig)
      ? candidate.boardStickerConfig.map((config) => ({
          ...config,
          system: Array.isArray(config.system) ? config.system : [],
          custom: Array.isArray(config.custom) ? config.custom : [],
          numeric: Array.isArray(config.numeric) ? config.numeric : [],
        }))
      : [],
    lastSyncAt: typeof candidate.lastSyncAt === 'string' ? candidate.lastSyncAt : null,
  };
}

function getBoardProjectId(
  board: YouGileBoard & {
    projectID?: string;
    project_id?: string;
    project?: string | { id?: string };
    projects?: Array<string | { id?: string }>;
    projectIds?: string[];
    project_ids?: string[];
  },
): string | undefined {
  if (board.projectId) {
    return board.projectId;
  }

  if (board.projectID) {
    return board.projectID;
  }

  if (board.project_id) {
    return board.project_id;
  }

  if (typeof board.project === 'string') {
    return board.project;
  }

  if (board.project?.id) {
    return board.project.id;
  }

  const project = board.projects?.[0];

  if (typeof project === 'string') {
    return project;
  }

  if (project?.id) {
    return project.id;
  }

  return board.projectIds?.[0] ?? board.project_ids?.[0];
}
