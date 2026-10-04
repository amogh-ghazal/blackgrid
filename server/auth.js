import { createHmac, randomBytes, timingSafeEqual, createPublicKey, verify as verifySignature } from 'node:crypto';

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SESSION_SECRET) throw new Error('AUTH_SESSION_SECRET must be configured in production.');
const secret = process.env.AUTH_SESSION_SECRET || randomBytes(32).toString('base64url');
const lifetime = 365 * 24 * 60 * 60;
const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
let googleKeys = null, googleKeysExpireAt = 0;
async function getGoogleKeys(force = false) {
  if (!force && googleKeys && Date.now() < googleKeysExpireAt) return googleKeys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Google key service unavailable');
  const data = await response.json();
  googleKeys = data.keys || [];
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300);
  googleKeysExpireAt = Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000;
  return googleKeys;
}
export async function verifyGoogleCredential(token, expectedAudience) {
  if (typeof token !== 'string') throw new Error('Invalid Google credential');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid Google credential');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Google credential');
  let keys = await getGoogleKeys();
  let jwk = keys.find(key => key.kid === header.kid && key.use === 'sig' && key.alg === 'RS256');
  if (!jwk) { keys = await getGoogleKeys(true); jwk = keys.find(key => key.kid === header.kid && key.use === 'sig' && key.alg === 'RS256'); }
  if (!jwk || !verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid Google signature');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== expectedAudience || Number(claims.exp) <= Date.now() / 1000) throw new Error('Invalid Google account claims');
  return claims;
}
export function issueSession(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + lifetime })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function readSession(cookieHeader = '') {
  const token = cookieHeader.match(/(?:^|;\s*)blackgrid_session=([^;]+)/)?.[1];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload)); const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const user = JSON.parse(Buffer.from(payload, 'base64url').toString()); return user.exp > Date.now() / 1000 ? user : null; }
  catch { return null; }
}
export function sessionCookie(token, secure = true) {
  return `blackgrid_session=${token}; Path=/; Max-Age=${lifetime}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export function clearSessionCookie(secure = true) {
  return `blackgrid_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
