import { describe, expect, it } from 'vitest';
import { getUserDisplayName } from './usersApi';

describe('usersApi', () => {
  it('uses real name when it differs from email', () => {
    expect(
      getUserDisplayName({
        id: 'user-1',
        email: 'user@example.com',
        realName: 'Елизавета Казакова',
      }),
    ).toBe('Елизавета Казакова');
  });

  it('uses email when API realName is the email', () => {
    expect(
      getUserDisplayName({
        id: 'user-1',
        email: 'miatchina.lera@gmail.com',
        realName: 'miatchina.lera@gmail.com',
      }),
    ).toBe('miatchina.lera@gmail.com');
  });
});
