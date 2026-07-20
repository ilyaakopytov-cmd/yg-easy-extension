import type { ApiKeyStorageMode } from '../storage/settingsStorage';
import type { YouGileApiKeySummary } from '../api/tokensApi';
import type { CreateTaskPayload } from '../api/tasksApi';
import type { TaskTreeCreationSummary } from '../task-tree/taskTreeCreator';
import type { TaskNode } from '../task-tree/taskTreeTypes';
import type { TaskTreeValidationResult } from '../task-tree/taskTreeValidator';

export type SyncYouGileDirectoriesRequest = {
  type: 'YG_EASY_SYNC_DIRECTORIES';
};

export type CheckYouGileConnectionRequest = {
  type: 'YG_EASY_CHECK_CONNECTION';
  apiKey?: string;
  storageMode?: ApiKeyStorageMode;
  rememberApiKey?: boolean;
};

export type CreateYouGileTaskTreeRequest = {
  type: 'YG_EASY_CREATE_TASK_TREE';
  root: TaskNode;
};

export type RequestYouGileApiKeyRequest = {
  type: 'YG_EASY_REQUEST_API_KEY';
  login: string;
  password: string;
  companyId: string;
  autoSaveRequestedToken: boolean;
};

export type RequestYouGileApiKeyResult = {
  token: YouGileApiKeySummary;
  savedLocally: boolean;
};

export type LoadYouGileApiKeysRequest = {
  type: 'YG_EASY_LOAD_API_KEYS';
  login: string;
  password: string;
  companyId: string;
};

export type LoadYouGileApiKeysResult = {
  tokens: YouGileApiKeySummary[];
};

export type DeleteYouGileApiKeyRequest = {
  type: 'YG_EASY_DELETE_API_KEY';
  apiKey: string;
};

export type DeleteYouGileApiKeyResult = {
  deleted: true;
};

export type CreateYouGileTaskTreeResult = {
  rootTaskId?: string;
  createdTasks: Array<{
    localId: string;
    title: string;
    yougileTaskId: string;
    payload?: CreateTaskPayload;
    deadlineUpdate?: {
      requested: boolean;
      ok: boolean;
      error?: string;
    };
  }>;
  validation: TaskTreeValidationResult;
  summary: TaskTreeCreationSummary;
  root: TaskNode;
  debug?: {
    serviceWorkerVersion: string;
  };
  error?: string;
};

export type PingRequest = {
  type: 'YG_EASY_PING';
};

export type SyncDirectoriesProgressMessage = {
  type: 'YG_EASY_SYNC_DIRECTORIES_PROGRESS';
  status: 'rate_limited';
};

export type BackgroundRequest =
  | PingRequest
  | CheckYouGileConnectionRequest
  | SyncYouGileDirectoriesRequest
  | CreateYouGileTaskTreeRequest
  | RequestYouGileApiKeyRequest
  | LoadYouGileApiKeysRequest
  | DeleteYouGileApiKeyRequest;

export type BackgroundResponse<T = unknown> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
      status?: number;
    };

export async function sendBackgroundMessage<T>(message: BackgroundRequest): Promise<BackgroundResponse<T>> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return {
      ok: false,
      error: 'Chrome runtime is unavailable in web prototype mode.',
    };
  }

  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundResponse<T>;
  } catch (error) {
    return {
      ok: false,
      error: getRuntimeMessageError(error),
    };
  }
}

function getRuntimeMessageError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return 'Канал связи с service worker был закрыт до получения ответа.';
}
