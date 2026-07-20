export const YOUGILE_API_BASE_URL = 'https://yougile.com/api-v2';

export function buildYouGileHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export type YouGileRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

export type YouGileApiError = {
  status: number;
  message: string;
};

export async function yougileRequest<T>(
  resource: string,
  apiKey: string,
  options: YouGileRequestOptions = {},
): Promise<T> {
  const response = await fetch(`${YOUGILE_API_BASE_URL}${resource}`, {
    method: options.method ?? 'GET',
    headers: buildYouGileHeaders(apiKey),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw {
      status: response.status,
      message: `YouGile API request failed with status ${response.status}`,
    } satisfies YouGileApiError;
  }

  return (await response.json()) as T;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '';
  }

  return '•'.repeat(Math.max(apiKey.length, 8));
}
