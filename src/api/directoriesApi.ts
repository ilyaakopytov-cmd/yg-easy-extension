import type { BoardsResponse } from './boardsApi';
import type { YouGileProject } from './projectsApi';
import type { YouGileStringSticker } from './stickersApi';
import type { YouGileUser } from './usersApi';
import { yougileRequest, type YouGileApiError } from './yougileClient';
import type { BoardStickerConfig, DirectoriesCache } from '../storage/directoriesStorage';

type YouGileListResponse<T> = {
  content?: T[];
};

type YouGilePagedListResponse<T> = YouGileListResponse<T> & {
  paging?: {
    count?: number;
    limit?: number;
    offset?: number;
    next?: boolean;
  };
};

type NamedEntity = {
  id: string;
  title?: string;
  name?: string;
};

type RawBoard = NamedEntity & {
  projectId?: string;
  projectID?: string;
  project_id?: string;
  project?: string | { id?: string };
  projects?: Array<string | { id?: string }>;
  projectIds?: string[];
  project_ids?: string[];
  stickers?: BoardsResponse['content'][number]['stickers'];
};

type RawColumn = NamedEntity & {
  boardId: string;
};

type ScopedBoardsResult = {
  projectId: string;
  boards: RawBoard[];
  boardIds: Set<string>;
};

export type SyncDirectoriesOptions = {
  onRateLimit?: () => void;
};

type ReadListPagesOptions = {
  rateLimitController?: DirectoryRateLimitController;
};

const NUMERIC_STICKER_TITLE_BY_ID: Record<string, string> = {
  '6421ea8e-e490-4b12-a09c-0a571dc5780b': 'План Сегодня',
  '0355a80e-ee44-430f-9c05-bc7f21950860': 'Факт часов',
  '0886f234-c572-42fb-8ef0-810320b7897d': 'План Сегодня',
  '7e9057ad-a0a8-4126-b1a6-950906130039': 'Факт часов',
  '8a4ab364-b130-4cdb-a814-801a3a4176a4': 'Регулярная задача',
  '08a43040-64a0-425f-a98b-df23f74fdd00': 'Общий план',
  '1c765510-702f-44ec-807c-e18af011d08b': 'Общий факт',
  'e0d55a08-d708-427a-900d-fa0aeaf6be4d': 'План ОВК',
};

const LIST_PAGE_LIMIT = 1000;
const DIRECTORY_REQUEST_CONCURRENCY = 4;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const TRANSIENT_API_STATUSES = new Set([429, 502, 503, 504]);

export async function syncDirectoriesFromYouGile(
  apiKey: string,
  options: SyncDirectoriesOptions = {},
): Promise<DirectoriesCache> {
  const rateLimitController = new DirectoryRateLimitController(options.onRateLimit);
  const readOptions = { rateLimitController };
  const [projects, boards, columns, users, departments, stickers] = await Promise.all([
    readAllListPages<NamedEntity>('/projects', apiKey, LIST_PAGE_LIMIT, readOptions),
    readAllListPages<RawBoard>('/boards', apiKey, LIST_PAGE_LIMIT, readOptions),
    readAllListPages<RawColumn>('/columns', apiKey, LIST_PAGE_LIMIT, readOptions),
    readAllListPages<YouGileUser>('/users', apiKey, LIST_PAGE_LIMIT, readOptions),
    readAllListPages<NamedEntity>('/departments', apiKey, LIST_PAGE_LIMIT, readOptions),
    readAllListPages<YouGileStringSticker>('/string-stickers', apiKey, LIST_PAGE_LIMIT, readOptions),
  ]);
  const scopedBoards = await loadBoardsByProject(projects.content ?? [], (projectId) =>
    readAllListPages<RawBoard>(`/boards?projectId=${encodeURIComponent(projectId)}`, apiKey, LIST_PAGE_LIMIT, readOptions),
  );
  const syncedBoards = scopedBoards?.boards ?? (boards.content ?? []);

  return buildDirectoriesCache({
    projects,
    boards: { content: syncedBoards },
    columns,
    users,
    departments,
    stickers,
    boardProjectIds: scopedBoards?.projectIdsByBoardId,
    now: new Date(),
  });
}

export function buildDirectoriesCache(input: {
  projects: YouGileListResponse<NamedEntity>;
  boards: YouGileListResponse<RawBoard>;
  columns: YouGileListResponse<RawColumn>;
  users: YouGileListResponse<YouGileUser>;
  departments: YouGileListResponse<NamedEntity>;
  stickers: YouGileListResponse<YouGileStringSticker>;
  boardProjectIds?: Map<string, string>;
  now: Date;
}): DirectoriesCache {
  const stickers = input.stickers.content ?? [];

  return {
    projects: (input.projects.content ?? []).map((project) => normalizeTitle(project)),
    boards: (input.boards.content ?? []).map((board) => normalizeBoard(board, input.boardProjectIds)),
    columns: (input.columns.content ?? []).map((column) => normalizeTitle(column)),
    users: input.users.content ?? [],
    departments: (input.departments.content ?? []).map((department) => normalizeTitle(department)),
    stickers,
    boardStickerConfig: buildBoardStickerConfig(input.boards.content ?? [], stickers),
    lastSyncAt: input.now.toISOString(),
  };
}

export async function readAllListPages<T>(
  resource: string,
  apiKey: string,
  pageLimit = LIST_PAGE_LIMIT,
  options: ReadListPagesOptions = {},
): Promise<YouGileListResponse<T>> {
  const content: T[] = [];
  let offset = 0;

  for (let page = 0; page < 100; page += 1) {
    const response = await requestWithRetry<YouGilePagedListResponse<T>>(
      () => yougileRequest<YouGilePagedListResponse<T>>(withPagingParams(resource, pageLimit, offset), apiKey),
      options,
    );
    const pageContent = response.content ?? [];

    content.push(...pageContent);

    if (!response.paging?.next || !pageContent.length) {
      break;
    }

    const responseOffset = typeof response.paging.offset === 'number' ? response.paging.offset : offset;
    const responseLimit = typeof response.paging.limit === 'number' ? response.paging.limit : pageLimit;
    const nextOffset = responseOffset + responseLimit;

    if (nextOffset <= offset) {
      break;
    }

    offset = nextOffset;
  }

  return { content };
}

function withPagingParams(resource: string, limit: number, offset: number): string {
  const separator = resource.includes('?') ? '&' : '?';

  return `${resource}${separator}limit=${limit}&offset=${offset}`;
}

async function requestWithRetry<T>(
  request: () => Promise<T>,
  options: ReadListPagesOptions = {},
  maxRetries = 5,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await options.rateLimitController?.beforeRequest();
      return await request();
    } catch (error) {
      lastError = error;

      if (!isTransientApiError(error) || attempt === maxRetries) {
        throw error;
      }

      if (isRateLimitError(error)) {
        await options.rateLimitController?.pauseForRateLimit();
      } else {
        await delay(getRetryDelayMs(attempt));
      }
    }
  }

  throw lastError;
}

function getRetryDelayMs(attempt: number): number {
  return 500 * (attempt + 1);
}

function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as YouGileApiError).status === 429
  );
}

function isTransientApiError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as YouGileApiError).status === 'number' &&
    TRANSIENT_API_STATUSES.has((error as YouGileApiError).status)
  );
}

async function runLimited<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

class DirectoryRateLimitController {
  private cooldownUntil = 0;
  private cooldownPromise: Promise<void> | null = null;
  private hasNotified = false;

  constructor(private readonly onRateLimit?: () => void) {}

  async beforeRequest(): Promise<void> {
    if (this.cooldownPromise) {
      await this.cooldownPromise;
      return;
    }

    const waitMs = this.cooldownUntil - Date.now();

    if (waitMs > 0) {
      await delay(waitMs);
    }
  }

  async pauseForRateLimit(): Promise<void> {
    const nextCooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;

    if (!this.hasNotified) {
      this.hasNotified = true;
      this.onRateLimit?.();
    }

    if (this.cooldownPromise && this.cooldownUntil >= nextCooldownUntil) {
      await this.cooldownPromise;
      return;
    }

    this.cooldownUntil = nextCooldownUntil;
    this.cooldownPromise = delay(RATE_LIMIT_COOLDOWN_MS).finally(() => {
      if (Date.now() >= this.cooldownUntil) {
        this.cooldownPromise = null;
      }
    });

    await this.cooldownPromise;
  }
}

export async function loadBoardsByProject(
  projects: NamedEntity[],
  getBoards: (projectId: string) => Promise<YouGileListResponse<RawBoard>>,
): Promise<{ boards: RawBoard[]; projectIdsByBoardId: Map<string, string> } | undefined> {
  if (!projects.length) {
    return undefined;
  }

  const scopedResponses = await runLimited(
    projects.map((project) => async () => {
      try {
        const response = await getBoards(project.id);

        return {
          projectId: project.id,
          boards: response.content ?? [],
          boardIds: new Set((response.content ?? []).map((board) => board.id)),
        };
      } catch {
        return null;
      }
    }),
    DIRECTORY_REQUEST_CONCURRENCY,
  );
  const scopedBoards: ScopedBoardsResult[] = scopedResponses.filter(
    (item): item is ScopedBoardsResult => item !== null,
  );

  if (!scopedBoards.length) {
    return undefined;
  }

  const boardsById = new Map<string, RawBoard>();
  const projectIdsByBoardId = new Map<string, string[]>();

  for (const scopedBoard of scopedBoards) {
    for (const board of scopedBoard.boards) {
      boardsById.set(board.id, board);

      const projectIds = projectIdsByBoardId.get(board.id) ?? [];
      projectIds.push(scopedBoard.projectId);
      projectIdsByBoardId.set(board.id, projectIds);
    }
  }

  const serializedSets = new Set(
    scopedBoards.map((item) => Array.from(item.boardIds).sort().join('|')),
  );

  if (serializedSets.size <= 1 || !boardsById.size) {
    return undefined;
  }

  const boardProjectIds = new Map<string, string>();

  for (const [boardId, projectIds] of projectIdsByBoardId.entries()) {
    if (projectIds.length === 1) {
      boardProjectIds.set(boardId, projectIds[0]);
    }
  }

  return boardProjectIds.size
    ? {
        boards: Array.from(boardsById.values()),
        projectIdsByBoardId: boardProjectIds,
      }
    : undefined;
}

export async function loadColumnsByBoard(
  boards: NamedEntity[],
  getColumns: (boardId: string) => Promise<YouGileListResponse<RawColumn>>,
): Promise<RawColumn[] | undefined> {
  if (!boards.length) {
    return undefined;
  }

  const scopedResponses = await runLimited(
    boards.map((board) => async () => {
      try {
        const response = await getColumns(board.id);

        return {
          boardId: board.id,
          columns: (response.content ?? []).map((column) => ({
            ...column,
            boardId: column.boardId || board.id,
          })),
        };
      } catch {
        return null;
      }
    }),
    DIRECTORY_REQUEST_CONCURRENCY,
  );
  const scopedColumns = scopedResponses.filter(
    (item): item is { boardId: string; columns: RawColumn[] } => item !== null,
  );

  if (!scopedColumns.length) {
    return undefined;
  }

  const columnsById = new Map<string, RawColumn>();

  for (const scopedColumn of scopedColumns) {
    for (const column of scopedColumn.columns) {
      columnsById.set(column.id, column);
    }
  }

  return columnsById.size ? Array.from(columnsById.values()) : undefined;
}

export function buildBoardStickerConfig(
  boards: RawBoard[],
  stringStickers: YouGileStringSticker[],
): BoardStickerConfig[] {
  const stringStickerIds = new Set(stringStickers.map((sticker) => sticker.id));

  return boards.map((board) => {
    const stickerConfig = board.stickers ?? {};
    const system = Object.entries(stickerConfig)
      .filter(([key, value]) => key !== 'custom' && value === true)
      .map(([key]) => key);
    const customIds = Object.entries(stickerConfig.custom ?? {})
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);

    return {
      boardId: board.id,
      system,
      custom: customIds.filter((id) => stringStickerIds.has(id)),
      numeric: customIds
        .filter((id) => !stringStickerIds.has(id))
        .map((id) => ({
          id,
          title: NUMERIC_STICKER_TITLE_BY_ID[id] ?? id,
        })),
    };
  });
}

function normalizeTitle<T extends NamedEntity>(entity: T): T & { title: string } {
  return {
    ...entity,
    title: entity.title ?? entity.name ?? entity.id,
  };
}

function normalizeBoard(board: RawBoard, boardProjectIds?: Map<string, string>): RawBoard & { title: string } {
  return {
    ...normalizeTitle(board),
    projectId: boardProjectIds?.get(board.id) ?? getBoardProjectId(board),
  };
}

function getBoardProjectId(board: RawBoard): string | undefined {
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
