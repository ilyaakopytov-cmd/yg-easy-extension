import { YOUGILE_API_BASE_URL, maskApiKey } from './yougileClient';

export type YouGileAuthCredentials = {
  login: string;
  password: string;
  companyId: string;
};

export type YouGileApiKeySummary = {
  id: string;
  name: string;
  maskedToken: string;
  visibleToken: string;
  createdAt: string;
};

export type YouGileApiKeyRequestResult = YouGileApiKeySummary & {
  apiKey: string;
};

type UnknownRecord = Record<string, unknown>;

export async function requestYouGileApiKey(credentials: YouGileAuthCredentials): Promise<YouGileApiKeyRequestResult> {
  const response = await authRequest<unknown>('/auth/keys', credentials);
  const apiKey = extractApiKey(response);

  if (!apiKey) {
    throw new Error('YouGile не вернул API-ключ в ответе.');
  }

  return {
    id: extractString(response, ['id', 'keyId', 'tokenId']) || makeLocalTokenId(apiKey),
    name: extractString(response, ['name', 'title']) || 'Токен YouGile',
    maskedToken: maskApiKey(apiKey),
    visibleToken: apiKey,
    createdAt: extractString(response, ['createdAt', 'created']) || new Date().toISOString(),
    apiKey,
  };
}

export async function loadYouGileApiKeys(credentials: YouGileAuthCredentials): Promise<YouGileApiKeySummary[]> {
  const response = await authRequest<unknown>('/auth/keys/get', credentials);
  const items = extractList(response);

  return items.map((item, index) => {
    const rawToken = extractString(item, ['key', 'apiKey', 'token', 'accessToken']);
    const visibleToken = extractString(item, ['key', 'apiKey', 'token', 'accessToken', 'maskedToken', 'maskedKey', 'keyMasked']);

    return {
      id: extractString(item, ['id', 'keyId', 'tokenId']) || `yougile-token-${index}`,
      name: extractString(item, ['name', 'title']) || `Токен ${index + 1}`,
      maskedToken: maskApiKey(rawToken || visibleToken || '********'),
      visibleToken: visibleToken || 'Токен не передан API',
      createdAt: extractString(item, ['createdAt', 'created']) || '',
    };
  });
}

export async function deleteYouGileApiKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();

  if (!key) {
    throw new Error('API-ключ для удаления не указан.');
  }

  const response = await fetch(`${YOUGILE_API_BASE_URL}/auth/keys/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw {
      status: response.status,
      message: `YouGile API request failed with status ${response.status}`,
    };
  }
}

async function authRequest<T>(resource: string, credentials: YouGileAuthCredentials): Promise<T> {
  const response = await fetch(`${YOUGILE_API_BASE_URL}${resource}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      login: credentials.login,
      password: credentials.password,
      companyId: credentials.companyId,
    }),
  });

  if (!response.ok) {
    throw {
      status: response.status,
      message: `YouGile API request failed with status ${response.status}`,
    };
  }

  return (await response.json()) as T;
}

function extractApiKey(response: unknown): string {
  if (typeof response === 'string') {
    return response;
  }

  const direct = extractString(response, ['key', 'apiKey', 'token', 'accessToken']);
  if (direct) {
    return direct;
  }

  if (isRecord(response)) {
    for (const value of Object.values(response)) {
      const nested = extractApiKey(value);
      if (nested) {
        return nested;
      }
    }
  }

  return '';
}

function extractList(response: unknown): UnknownRecord[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }

  if (!isRecord(response)) {
    return [];
  }

  for (const key of ['content', 'keys', 'items', 'tokens', 'data']) {
    const value = response[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function extractString(source: unknown, keys: string[]): string {
  if (!isRecord(source)) {
    return '';
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function makeLocalTokenId(apiKey: string): string {
  return `yougile-token-${apiKey.length}-${Date.now().toString(36)}`;
}
