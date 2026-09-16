import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyGoogleIdToken } from '../src/modules/auth/google_identity.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

function fakeResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe('verifyGoogleIdToken', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_OAUTH_WEB_CLIENT_ID', CLIENT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('throws GOOGLE_SIGN_IN_UNAVAILABLE when no web client id is configured', async () => {
    vi.stubEnv('GOOGLE_OAUTH_WEB_CLIENT_ID', '');

    await expect(verifyGoogleIdToken('any-token')).rejects.toMatchObject({
      code: 'GOOGLE_SIGN_IN_UNAVAILABLE',
    });
  });

  it('throws INVALID_GOOGLE_TOKEN when the tokeninfo endpoint rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({}, false)));

    await expect(verifyGoogleIdToken('bad-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('throws INVALID_GOOGLE_TOKEN when aud does not match the configured client id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: 'other-client-id',
      email_verified: 'true',
      iss: 'accounts.google.com',
      sub: 'sub-1',
      email: 'ana@example.com',
    })));

    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('throws INVALID_GOOGLE_TOKEN when the email is not verified', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: CLIENT_ID,
      email_verified: 'false',
      iss: 'accounts.google.com',
      sub: 'sub-1',
      email: 'ana@example.com',
    })));

    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('throws INVALID_GOOGLE_TOKEN when the issuer is not a Google issuer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: CLIENT_ID,
      email_verified: 'true',
      iss: 'https://evil.example.com',
      sub: 'sub-1',
      email: 'ana@example.com',
    })));

    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('throws INVALID_GOOGLE_TOKEN when sub or email are missing or not strings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: CLIENT_ID,
      email_verified: 'true',
      iss: 'accounts.google.com',
      sub: 42,
      email: 'ana@example.com',
    })));

    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });

    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: CLIENT_ID,
      email_verified: 'true',
      iss: 'accounts.google.com',
      sub: 'sub-1',
    })));

    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('returns the lowercased identity for a valid payload, accepting both Google issuer forms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: CLIENT_ID,
      email_verified: 'true',
      iss: 'accounts.google.com',
      sub: 'sub-1',
      email: 'Ana@Example.com',
      name: 'Ana Torres',
    })));

    await expect(verifyGoogleIdToken('token')).resolves.toEqual({
      subject: 'sub-1',
      email: 'ana@example.com',
      name: 'Ana Torres',
    });

    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: CLIENT_ID,
      email_verified: 'true',
      iss: 'https://accounts.google.com',
      sub: 'sub-2',
      email: 'beatriz@example.com',
    })));

    await expect(verifyGoogleIdToken('token')).resolves.toEqual({
      subject: 'sub-2',
      email: 'beatriz@example.com',
      name: 'beatriz',
    });
  });

  it('falls back to the email local part when name is blank', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({
      aud: CLIENT_ID,
      email_verified: 'true',
      iss: 'accounts.google.com',
      sub: 'sub-3',
      email: 'carla@example.com',
      name: '   ',
    })));

    await expect(verifyGoogleIdToken('token')).resolves.toEqual({
      subject: 'sub-3',
      email: 'carla@example.com',
      name: 'carla',
    });
  });
});
