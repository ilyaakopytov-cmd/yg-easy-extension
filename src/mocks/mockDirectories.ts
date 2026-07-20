import type { YouGileBoard } from '../api/boardsApi';
import type { YouGileColumn } from '../api/columnsApi';
import type { YouGileDepartment } from '../api/departmentsApi';
import type { YouGileProject } from '../api/projectsApi';
import type { YouGileStringSticker } from '../api/stickersApi';
import type { YouGileUser } from '../api/usersApi';
import type { BoardStickerConfig, DirectoriesCache } from '../storage/directoriesStorage';
import boardStickerConfig from './boardStickerConfig.json';
import boards from './boards.json';
import columns from './columns.json';
import departments from './departments.json';
import projects from './projects.json';
import stickers from './stickers.json';
import users from './users.json';

export function loadMockDirectories(now = new Date()): DirectoriesCache {
  return {
    projects: projects as YouGileProject[],
    boards: boards as YouGileBoard[],
    columns: columns as YouGileColumn[],
    users: users as YouGileUser[],
    departments: departments as YouGileDepartment[],
    stickers: stickers as YouGileStringSticker[],
    boardStickerConfig: boardStickerConfig as BoardStickerConfig[],
    lastSyncAt: now.toISOString(),
  };
}
