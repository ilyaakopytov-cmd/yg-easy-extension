import { describe, expect, it } from 'vitest';
import { buildYouGileHeaders, maskApiKey } from './yougileClient';

describe('yougileClient', () => {
  it('builds Authorization header at request time', () => {
    expect(buildYouGileHeaders('secret-token')).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer secret-token',
    });
  });

  it('masks api key without leaving visible characters', () => {
    expect(maskApiKey('abcdefghijklmnopqrstuvwxyz1234')).toBe('•'.repeat(30));
  });
});
