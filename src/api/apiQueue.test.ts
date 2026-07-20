import { describe, expect, it } from 'vitest';
import { runApiQueue, type ApiQueueItem } from './apiQueue';

describe('apiQueue', () => {
  it('runs queue items sequentially', async () => {
    const calls: string[] = [];
    const items: ApiQueueItem[] = [
      { type: 'createTask', localId: 'a', payload: { title: 'A' }, retryCount: 0 },
      { type: 'createTask', localId: 'b', payload: { title: 'B' }, retryCount: 0 },
    ];

    const result = await runApiQueue(items, async (item) => {
      calls.push(item.localId);
      return { id: `task-${item.localId}` };
    });

    expect(calls).toEqual(['a', 'b']);
    expect(result.created).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('skips items that already have yougileTaskId', async () => {
    const calls: string[] = [];
    const items: ApiQueueItem[] = [
      { type: 'createTask', localId: 'created', payload: {}, retryCount: 0, yougileTaskId: 'task-created' },
      { type: 'createTask', localId: 'new', payload: {}, retryCount: 0 },
    ];

    const result = await runApiQueue(items, async (item) => {
      calls.push(item.localId);
      return { id: `task-${item.localId}` };
    });

    expect(calls).toEqual(['new']);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
    expect(result.items[0]).toEqual({
      localId: 'created',
      status: 'skipped',
      yougileTaskId: 'task-created',
    });
  });

  it('retries 429 errors and then continues', async () => {
    let attempts = 0;

    const result = await runApiQueue(
      [{ type: 'createTask', localId: 'rate-limited', payload: {}, retryCount: 0 }],
      async () => {
        attempts += 1;

        if (attempts === 1) {
          throw { status: 429, message: 'Too many requests' };
        }

        return { id: 'task-ok' };
      },
      { delay: async () => undefined },
    );

    expect(attempts).toBe(2);
    expect(result.created).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('stops at first non-retryable error and returns partial result', async () => {
    const items: ApiQueueItem[] = [
      { type: 'createTask', localId: 'ok', payload: {}, retryCount: 0 },
      { type: 'createTask', localId: 'bad', payload: {}, retryCount: 0 },
      { type: 'createTask', localId: 'never', payload: {}, retryCount: 0 },
    ];

    const calls: string[] = [];
    const result = await runApiQueue(items, async (item) => {
      calls.push(item.localId);

      if (item.localId === 'bad') {
        throw { status: 400, message: 'Bad request' };
      }

      return { id: `task-${item.localId}` };
    });

    expect(calls).toEqual(['ok', 'bad']);
    expect(result).toEqual({
      created: 1,
      skipped: 0,
      errors: 1,
      stoppedAt: 'bad',
      items: [
        { localId: 'ok', status: 'created', yougileTaskId: 'task-ok' },
        { localId: 'bad', status: 'error', error: 'Bad request' },
      ],
    });
  });
});
