export type GoogleIdentity = {
  subject: string;
  email: string;
  name: string;
};

export class GoogleIdentityError extends Error {
  constructor(public readonly code: 'GOOGLE_SIGN_IN_UNAVAILABLE' | 'INVALID_GOOGLE_TOKEN') {
    super(code);
  }
}

/** Verifies a Google ID token against the configured web OAuth client. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_OAUTH_WEB_CLIENT_ID?.trim();
  if (!clientId) throw new GoogleIdentityError('GOOGLE_SIGN_IN_UNAVAILABLE');
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!response.ok) throw new GoogleIdentityError('INVALID_GOOGLE_TOKEN');
  const payload = await response.json() as Record<string, unknown>;
  const issuer = payload.iss;
  const email = payload.email;
  const subject = payload.sub;
  if (
    payload.aud !== clientId ||
    payload.email_verified !== 'true' ||
    (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') ||
    typeof email !== 'string' ||
    typeof subject !== 'string'
  ) {
    throw new GoogleIdentityError('INVALID_GOOGLE_TOKEN');
  }
  const name = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : email.split('@')[0];
  return { subject, email: email.toLowerCase(), name };
}

export function googleSignInEnabled() {
  return Boolean(process.env.GOOGLE_OAUTH_WEB_CLIENT_ID?.trim());
}
