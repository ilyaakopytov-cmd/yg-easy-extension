export type ApiQueueItem<TPayload = object> = {
  type: 'createTask' | 'updateTask';
  localId: string;
  payload: TPayload;
  retryCount: number;
  yougileTaskId?: string;
};

export type ApiQueueItemResult = {
  localId: string;
  status: 'created' | 'skipped' | 'error';
  yougileTaskId?: string;
  error?: string;
};

export type ApiQueueRunResult = {
  created: number;
  skipped: number;
  errors: number;
  stoppedAt?: string;
  items: ApiQueueItemResult[];
};

export type ApiQueueExecutor<TPayload, TResult extends { id?: string }> = (
  item: ApiQueueItem<TPayload>,
) => Promise<TResult>;

export type ApiQueueOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
  delay?: (ms: number) => Promise<void>;
};

export async function runApiQueue<TPayload, TResult extends { id?: string }>(
  items: ApiQueueItem<TPayload>[],
  executor: ApiQueueExecutor<TPayload, TResult>,
  options: ApiQueueOptions = {},
): Promise<ApiQueueRunResult> {
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const delay = options.delay ?? defaultDelay;
  const results: ApiQueueItemResult[] = [];

  for (const item of items) {
    if (item.yougileTaskId) {
      results.push({
        localId: item.localId,
        status: 'skipped',
        yougileTaskId: item.yougileTaskId,
      });
      continue;
    }

    const result = await executeWithRetry(item, executor, maxRetries, retryDelayMs, delay);
    results.push(result);

    if (result.status === 'error') {
      return summarizeQueueResults(results, item.localId);
    }
  }

  return summarizeQueueResults(results);
}

async function executeWithRetry<TPayload, TResult extends { id?: string }>(
  item: ApiQueueItem<TPayload>,
  executor: ApiQueueExecutor<TPayload, TResult>,
  maxRetries: number,
  retryDelayMs: number,
  delay: (ms: number) => Promise<void>,
): Promise<ApiQueueItemResult> {
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const result = await executor({ ...item, retryCount: attempt });

      return {
        localId: item.localId,
        status: 'created',
        yougileTaskId: result.id,
      };
    } catch (error) {
      const canRetry = isRetryableError(error) && attempt < maxRetries;

      if (!canRetry) {
        return {
          localId: item.localId,
          status: 'error',
          error: getErrorMessage(error),
        };
      }

      attempt += 1;
      await delay(retryDelayMs * attempt);
    }
  }

  return {
    localId: item.localId,
    status: 'error',
    error: 'Не удалось выполнить запрос.',
  };
}

function summarizeQueueResults(items: ApiQueueItemResult[], stoppedAt?: string): ApiQueueRunResult {
  return {
    created: items.filter((item) => item.status === 'created').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    errors: items.filter((item) => item.status === 'error').length,
    stoppedAt,
    items,
  };
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    return (error as { status?: number }).status === 429;
  }

  return false;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return 'Неизвестная ошибка API.';
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
