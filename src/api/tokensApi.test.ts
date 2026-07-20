import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteYouGileApiKey, loadYouGileApiKeys, requestYouGileApiKey } from './tokensApi';

const fetchMock = vi.fn();

describe('tokensApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('requests api key without bearer authorization and masks it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ key: 'secret-api-key', id: 'key-1', name: 'YG Easy' }),
    });

    await expect(
      requestYouGileApiKey({
        login: 'user@example.com',
        password: 'password',
        companyId: 'company-1',
      }),
    ).resolves.toMatchObject({
      id: 'key-1',
      name: 'YG Easy',
      apiKey: 'secret-api-key',
      maskedToken: '•'.repeat('secret-api-key'.length),
      visibleToken: 'secret-api-key',
    });

    expect(fetchMock).toHaveBeenCalledWith('https://yougile.com/api-v2/auth/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        login: 'user@example.com',
        password: 'password',
        companyId: 'company-1',
      }),
    });
  });

  it('loads api keys from content list', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            id: 'key-1',
            title: 'Main key',
            key: 'visible-api-key',
            createdAt: '2026-07-09T00:00:00.000Z',
          },
        ],
      }),
    });

    await expect(
      loadYouGileApiKeys({
        login: 'user@example.com',
        password: 'password',
        companyId: 'company-1',
      }),
    ).resolves.toEqual([
      {
        id: 'key-1',
        name: 'Main key',
        maskedToken: '•'.repeat('visible-api-key'.length),
        visibleToken: 'visible-api-key',
        createdAt: '2026-07-09T00:00:00.000Z',
      },
    ]);
  });

  it('deletes api key by key value', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
    });

    await expect(deleteYouGileApiKey('visible-api-key')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith('https://yougile.com/api-v2/auth/keys/visible-api-key', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  });
});
