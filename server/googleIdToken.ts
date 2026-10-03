import crypto from 'crypto';
import { google } from 'googleapis';

// -------------------------------------------------------------
// Google ID token nonce & replay protection
// -------------------------------------------------------------
//
// The app requests a single-use nonce from the server before starting
// Google Sign-In (Android Credential Manager or web Google Identity
// Services). Google embeds it in the signed ID token, and the server
// accepts the token only if the nonce was issued here, is unexpired
// and has not been used. Every accepted token is also remembered until
// it expires so the same token can never be replayed.

const GOOGLE_NONCE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_NONCE_MAX_ENTRIES = 20000;
// Tokens without a nonce (legacy Google Sign-In fallback on devices
// where Credential Manager is unavailable) must be freshly issued.
const GOOGLE_NONCELESS_MAX_AGE_SEC = 5 * 60;

const googleSignInNonces = new Map<string, number>();
const usedGoogleIdTokens = new Map<string, number>();

setInterval(() => {
  const now = Date.now();

  for (const [nonce, expiresAt] of googleSignInNonces.entries()) {
    if (expiresAt <= now) googleSignInNonces.delete(nonce);
  }

  for (const [hash, expiresAt] of usedGoogleIdTokens.entries()) {
    if (expiresAt <= now) usedGoogleIdTokens.delete(hash);
  }
}, 60 * 1000).unref?.();

export function issueGoogleSignInNonce(): string {
  if (googleSignInNonces.size >= GOOGLE_NONCE_MAX_ENTRIES) {
    // Drop the oldest entries; Map preserves insertion order.
    const excess = googleSignInNonces.size - GOOGLE_NONCE_MAX_ENTRIES + 1;
    let removed = 0;

    for (const key of googleSignInNonces.keys()) {
      googleSignInNonces.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }

  const nonce = crypto.randomBytes(32).toString('base64url');
  googleSignInNonces.set(nonce, Date.now() + GOOGLE_NONCE_TTL_MS);
  return nonce;
}

let googleIdTokenVerifier: InstanceType<typeof google.auth.OAuth2> | null = null;

function getGoogleIdTokenVerifier() {
  if (!googleIdTokenVerifier) {
    googleIdTokenVerifier = new google.auth.OAuth2();
  }

  return googleIdTokenVerifier;
}

export type GoogleIdTokenVerifyFn = (
  idToken: string,
  audiences: string[]
) => Promise<Record<string, any> | undefined>;

export type GoogleIdTokenCheck =
  | { ok: true; payload: Record<string, any> }
  | { ok: false; status: number; error: string };

/**
 * Verifies a Google ID token: signature (Google public keys), issuer,
 * audience and expiry via google-auth-library, then nonce, verified
 * email and replay. Exported for automated tests.
 */
export async function verifyGoogleIdTokenForSignIn(
  idToken: string,
  allowedAudiences: Array<string | undefined | null>,
  options: {
    verify?: GoogleIdTokenVerifyFn;
  } = {}
): Promise<GoogleIdTokenCheck> {
  const audiences = allowedAudiences.filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );

  if (audiences.length === 0) {
    return {
      ok: false,
      status: 503,
      error: 'Google Sign-In is not configured on the server.',
    };
  }

  let payload: Record<string, any> | undefined;

  try {
    payload = options.verify
      ? await options.verify(idToken, audiences)
      : (
          await getGoogleIdTokenVerifier().verifyIdToken({
            idToken,
            audience: audiences,
          })
        ).getPayload();
  } catch (verifyErr: any) {
    console.error(
      '[GoogleAuth] ID token verification failed:',
      verifyErr?.message || 'unknown error'
    );

    return {
      ok: false,
      status: 401,
      error:
        'Google ID token verification failed. The provided token is invalid, expired, or untrusted.',
    };
  }

  if (!payload) {
    return { ok: false, status: 401, error: 'Google ID token is invalid.' };
  }

  // Defence in depth: these are also checked by google-auth-library.
  if (!audiences.includes(payload.aud)) {
    return {
      ok: false,
      status: 401,
      error: 'Google token audience mismatch. Token was not minted for this application.',
    };
  }

  if (
    payload.iss !== 'accounts.google.com' &&
    payload.iss !== 'https://accounts.google.com'
  ) {
    return { ok: false, status: 401, error: 'Google token issuer is untrusted.' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp);

  if (!Number.isFinite(exp) || exp <= nowSec) {
    return { ok: false, status: 401, error: 'Google ID token has expired.' };
  }

  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    return { ok: false, status: 401, error: 'Google account email is not verified.' };
  }

  if (typeof payload.nonce === 'string' && payload.nonce.length > 0) {
    const nonceExpiry = googleSignInNonces.get(payload.nonce);

    if (!nonceExpiry || nonceExpiry <= Date.now()) {
      googleSignInNonces.delete(payload.nonce);

      return {
        ok: false,
        status: 401,
        error: 'This Google sign-in request has expired. Please try again.',
      };
    }

    // Single use.
    googleSignInNonces.delete(payload.nonce);
  } else {
    const iat = Number(payload.iat);

    if (!Number.isFinite(iat) || nowSec - iat > GOOGLE_NONCELESS_MAX_AGE_SEC) {
      return {
        ok: false,
        status: 401,
        error: 'This Google sign-in request has expired. Please try again.',
      };
    }
  }

  const tokenHash = crypto.createHash('sha256').update(idToken).digest('hex');

  if (usedGoogleIdTokens.has(tokenHash)) {
    return {
      ok: false,
      status: 401,
      error: 'This Google sign-in token was already used. Please try again.',
    };
  }

  usedGoogleIdTokens.set(tokenHash, exp * 1000);

  return { ok: true, payload };
}


// -------------------------------------------------------------
// Pub/Sub push authentication (Google Play RTDN)
// -------------------------------------------------------------

/**
 * Verifies the OIDC token Pub/Sub attaches to authenticated push
 * requests: Google signature, issuer, expiry, the configured audience,
 * and that it was minted for the configured push service account.
 */
export async function verifyPubSubPushToken(
  authorizationHeader: string | undefined,
  config: { audience: string; serviceAccountEmail: string },
  options: { verify?: GoogleIdTokenVerifyFn } = {}
): Promise<boolean> {
  if (
    typeof authorizationHeader !== 'string' ||
    !authorizationHeader.startsWith('Bearer ')
  ) {
    return false;
  }

  const token = authorizationHeader.slice(7).trim();

  if (!token || token.length > 8192) return false;

  try {
    const payload = options.verify
      ? await options.verify(token, [config.audience])
      : (
          await getGoogleIdTokenVerifier().verifyIdToken({
            idToken: token,
            audience: config.audience,
          })
        ).getPayload();

    if (!payload) return false;

    if (payload.aud !== config.audience) return false;

    if (
      payload.iss !== 'accounts.google.com' &&
      payload.iss !== 'https://accounts.google.com'
    ) {
      return false;
    }

    if (Number(payload.exp) * 1000 <= Date.now()) return false;

    if (payload.email_verified !== true && payload.email_verified !== 'true') {
      return false;
    }

    return (
      typeof payload.email === 'string' &&
      payload.email.toLowerCase() === config.serviceAccountEmail.toLowerCase()
    );
  } catch (err: any) {
    console.error(
      '[RTDN] Push token verification failed:',
      err?.message || 'unknown error'
    );
    return false;
  }
}
