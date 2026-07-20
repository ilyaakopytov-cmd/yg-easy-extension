import { syncDirectoriesFromYouGile } from '../api/directoriesApi';
import type { ProjectsResponse } from '../api/projectsApi';
import { createTask as createYouGileTask } from '../api/tasksApi';
import {
  deleteYouGileApiKey,
  loadYouGileApiKeys,
  requestYouGileApiKey,
  type YouGileAuthCredentials,
} from '../api/tokensApi';
import { maskApiKey, yougileRequest, type YouGileApiError } from '../api/yougileClient';
import { createTaskTree, summarizeTaskTreeCreation } from '../task-tree/taskTreeCreator';
import type { TaskNode } from '../task-tree/taskTreeTypes';
import { validateTaskTree } from '../task-tree/taskTreeValidator';
import {
  readApiKey,
  readSettings,
  writeApiKey,
  writeSettings,
  type ApiKeyStorageMode,
} from '../storage/settingsStorage';
import { writeDirectoriesCache } from '../storage/directoriesStorage';
import type { BackgroundRequest, CreateYouGileTaskTreeResult, SyncDirectoriesProgressMessage } from './messages';

const SERVICE_WORKER_VERSION = 'deadline-diagnostics-2026-05-15-01';

chrome.runtime.onInstalled.addListener(() => {
  console.info('YG Easy extension installed.');
});

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  if (message?.type === 'YG_EASY_PING') {
    sendResponse({ ok: true, data: { source: 'service-worker' } });
    return true;
  }

  if (message?.type === 'YG_EASY_CHECK_CONNECTION') {
    void checkConnection(message.apiKey, message.storageMode, message.rememberApiKey)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: YouGileApiError | Error) => {
        sendResponse({
          ok: false,
          error: error.message,
          status: 'status' in error ? error.status : undefined,
        });
      });

    return true;
  }

  if (message?.type === 'YG_EASY_SYNC_DIRECTORIES') {
    void syncDirectories()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: YouGileApiError | Error) => {
        sendResponse({
          ok: false,
          error: error.message,
          status: 'status' in error ? error.status : undefined,
        });
      });

    return true;
  }

  if (message?.type === 'YG_EASY_REQUEST_API_KEY') {
    void requestApiKeyFromCredentials({
      login: message.login,
      password: message.password,
      companyId: message.companyId,
    }, message.autoSaveRequestedToken)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: YouGileApiError | Error) => {
        sendResponse({
          ok: false,
          error: error.message,
          status: 'status' in error ? error.status : undefined,
        });
      });

    return true;
  }

  if (message?.type === 'YG_EASY_LOAD_API_KEYS') {
    void loadApiKeysFromCredentials({
      login: message.login,
      password: message.password,
      companyId: message.companyId,
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: YouGileApiError | Error) => {
        sendResponse({
          ok: false,
          error: error.message,
          status: 'status' in error ? error.status : undefined,
        });
      });

    return true;
  }

  if (message?.type === 'YG_EASY_DELETE_API_KEY') {
    void deleteApiKeyByValue(message.apiKey)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: YouGileApiError | Error) => {
        sendResponse({
          ok: false,
          error: error.message,
          status: 'status' in error ? error.status : undefined,
        });
      });

    return true;
  }

  if (message?.type === 'YG_EASY_CREATE_TASK_TREE') {
    void createTaskTreeFromMessage(message.root)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: YouGileApiError | Error) => {
        sendResponse({
          ok: false,
          error: error.message,
          status: 'status' in error ? error.status : undefined,
        });
      });

    return true;
  }

  return false;
});

async function checkConnection(
  providedApiKey?: string,
  storageMode?: ApiKeyStorageMode,
  rememberApiKey?: boolean,
) {
  const settings = await readSettings();
  const mode = storageMode ?? settings.apiKeyStorageMode;
  const apiKey = providedApiKey?.trim() || (await readApiKey(mode));

  if (!apiKey) {
    throw new Error('API-ключ YouGile не указан.');
  }

  const response = await yougileRequest<ProjectsResponse>('/projects', apiKey);

  if (providedApiKey) {
    await writeApiKey(apiKey, mode);
    await writeSettings({
      ...settings,
      apiKeyStorageMode: mode,
      rememberApiKey: Boolean(rememberApiKey),
      maskedApiKey: maskApiKey(apiKey),
    });
  }

  return {
    projectCount: response.content?.length ?? 0,
    maskedApiKey: maskApiKey(apiKey),
    storageMode: mode,
  };
}

async function syncDirectories() {
  const apiKey = await getStoredApiKey();
  const directories = await syncDirectoriesFromYouGile(apiKey, {
    onRateLimit: () =>
      sendRuntimeProgress({
        type: 'YG_EASY_SYNC_DIRECTORIES_PROGRESS',
        status: 'rate_limited',
      }),
  });

  await writeDirectoriesCache(directories);

  return {
    directories,
    counts: {
      projects: directories.projects.length,
      boards: directories.boards.length,
      linkedBoards: directories.boards.filter((board) => Boolean(board.projectId)).length,
      columns: directories.columns.length,
      users: directories.users.length,
      departments: directories.departments.length,
      stickers: directories.stickers.length,
    },
  };
}

async function requestApiKeyFromCredentials(
  credentials: YouGileAuthCredentials,
  autoSaveRequestedToken: boolean,
) {
  validateAuthCredentials(credentials);

  const result = await requestYouGileApiKey(credentials);

  if (autoSaveRequestedToken) {
    const settings = await readSettings();
    await writeApiKey(result.apiKey, 'local');
    await writeSettings({
      ...settings,
      apiKeyStorageMode: 'local',
      rememberApiKey: true,
      maskedApiKey: maskApiKey(result.apiKey),
    });
  }

  return {
    token: {
      id: result.id,
      name: result.name,
      maskedToken: result.maskedToken,
      visibleToken: result.visibleToken,
      createdAt: result.createdAt,
    },
    savedLocally: autoSaveRequestedToken,
  };
}

async function loadApiKeysFromCredentials(credentials: YouGileAuthCredentials) {
  validateAuthCredentials(credentials);

  return {
    tokens: await loadYouGileApiKeys(credentials),
  };
}

async function deleteApiKeyByValue(apiKey: string) {
  await deleteYouGileApiKey(apiKey);

  return {
    deleted: true,
  };
}

function validateAuthCredentials(credentials: YouGileAuthCredentials) {
  if (!credentials.companyId.trim()) {
    throw new Error('ID компании не указан.');
  }

  if (!credentials.login.trim()) {
    throw new Error('Логин или e-mail не указан.');
  }

  if (!credentials.password.trim()) {
    throw new Error('Пароль не указан.');
  }
}

function sendRuntimeProgress(message: SyncDirectoriesProgressMessage): void {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // The sync itself should continue even if no UI page is listening.
  }
}

async function createTaskTreeFromMessage(root: TaskNode) {
  const apiKey = await getStoredApiKey();

  try {
    const result = await createTaskTree(root, (payload) => createYouGileTask(apiKey, payload));
    const summary = summarizeTaskTreeCreation(root);

    return {
      ...result,
      summary,
      root,
      debug: {
        serviceWorkerVersion: SERVICE_WORKER_VERSION,
      },
    } satisfies CreateYouGileTaskTreeResult;
  } catch (error) {
    const summary = summarizeTaskTreeCreation(root);

    if (summary.created || summary.errors) {
      return {
        createdTasks: summary.items
          .filter((item) => item.yougileTaskId)
          .map((item) => ({
            localId: item.localId,
            title: item.title,
            yougileTaskId: item.yougileTaskId ?? '',
            payload: undefined,
            deadlineUpdate: undefined,
          })),
        validation: validateTaskTree(root),
        summary,
        root,
        debug: {
          serviceWorkerVersion: SERVICE_WORKER_VERSION,
        },
        error: getErrorMessage(error),
      } satisfies CreateYouGileTaskTreeResult;
    }

    throw error;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return 'Неизвестная ошибка создания задач.';
}

async function getStoredApiKey(): Promise<string> {
  const settings = await readSettings();
  const apiKey = await readApiKey(settings.apiKeyStorageMode);

  if (!apiKey) {
    throw new Error('API-ключ YouGile не указан. Сначала проверьте подключение в настройках.');
  }

  return apiKey;
}
