import crypto from 'node:crypto';
import './loadEnv.js';

const sessionCookieName = 'admin_session';
const sessionTtlHours = Number(process.env.ADMIN_SESSION_TTL_HOURS || 8);
const sessionTtlMs = (Number.isFinite(sessionTtlHours) && sessionTtlHours > 0 ? sessionTtlHours : 8) * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production';
const cookieDomain = String(process.env.ADMIN_COOKIE_DOMAIN || '').trim() || undefined;
const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
const adminPassword = typeof process.env.ADMIN_PASSWORD === 'string' ? process.env.ADMIN_PASSWORD : 'admin123';
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || 'change-this-admin-session-secret';
const requestedCookieSameSite = String(process.env.ADMIN_COOKIE_SAME_SITE || '').trim().toLowerCase();
const sessionCookieSameSite =
  requestedCookieSameSite === 'strict' || requestedCookieSameSite === 'lax' || requestedCookieSameSite === 'none'
    ? requestedCookieSameSite
    : isProduction
      ? 'none'
      : 'lax';
const isSecureCookie = isProduction || sessionCookieSameSite === 'none';

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex <= 0) {
        return cookies;
      }

      const key = decodeURIComponent(part.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());

      return {
        ...cookies,
        [key]: value
      };
    }, {});
}

function createSignature(payload) {
  return crypto.createHmac('sha256', adminSessionSecret).update(payload).digest('base64url');
}

function createSessionPayload(username) {
  return Buffer.from(
    JSON.stringify({
      username,
      expiresAt: Date.now() + sessionTtlMs
    }),
    'utf8'
  ).toString('base64url');
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken(username) {
  const payload = createSessionPayload(username);
  return `${payload}.${createSignature(payload)}`;
}

function parseSessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return null;
  }

  const [payload, signature] = token.split('.', 2);
  const expectedSignature = createSignature(payload);

  if (!safeEqualString(signature, expectedSignature)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (!data?.username || !data?.expiresAt || Number(data.expiresAt) <= Date.now()) {
      return null;
    }

    return {
      username: String(data.username),
      expiresAt: Number(data.expiresAt)
    };
  } catch {
    return null;
  }
}

export function getAdminAuthConfig() {
  return {
    username: adminUsername,
    sessionCookieName,
    sessionTtlHours: sessionTtlMs / (60 * 60 * 1000),
    sameSite: sessionCookieSameSite
  };
}

export function isValidAdminCredentials(username, password) {
  return safeEqualString((username || '').trim(), adminUsername) && safeEqualString(password || '', adminPassword);
}

export function readAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return parseSessionToken(cookies[sessionCookieName]);
}

export function setAdminSessionCookie(res, username = adminUsername) {
  res.cookie(sessionCookieName, createSessionToken(username), {
    httpOnly: true,
    sameSite: sessionCookieSameSite,
    secure: isSecureCookie,
    domain: cookieDomain,
    path: '/',
    maxAge: sessionTtlMs
  });
}

export function clearAdminSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: sessionCookieSameSite,
    secure: isSecureCookie,
    domain: cookieDomain,
    path: '/'
  });
}

export function requireAdminAuth(req, res, next) {
  const session = readAdminSession(req);

  if (!session) {
    return res.status(401).json({
      error: 'Can dang nhap quan tri.'
    });
  }

  req.adminSession = session;
  return next();
}
