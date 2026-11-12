/**
 * The API is called on the same origin as the page: in production Vercel
 * forwards /api/* to the API server (see vercel.json), and in development
 * Vite does (see vite.config.js). Same-origin means the refresh cookie is a
 * first-party cookie, which every browser keeps, including Safari, which
 * blocks cookies between different sites. Set VITE_API_URL only to call an
 * API on another origin directly.
 */
const API_URL = import.meta.env.VITE_API_URL || "";

/**
 * The access token lives in memory only — never localStorage/sessionStorage,
 * which are readable by any XSS payload. It's lost on refresh by design; the
 * httpOnly refresh cookie is what restores the session on page load.
 */
let accessToken = null;
let refreshPromise = null;
let onAuthFailure = () => {};

export function setAccessToken(token) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

export function setAuthFailureHandler(fn) {
  onAuthFailure = fn;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function buildRequest(path, options, withAuth) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (withAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  // "include" also sends the refresh cookie if VITE_API_URL points at
  // another origin; on the same origin it changes nothing.
  return fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
}

/**
 * Single-flight refresh: if several requests 401 at once, they all await the
 * same refresh call instead of racing and burning the rotated token.
 */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = buildRequest("/api/auth/refresh", { method: "POST" }, false)
      .then(async (res) => {
        if (!res.ok) throw new ApiError("Session expired", res.status);
        const data = await res.json();
        accessToken = data.accessToken;
        return data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once the API answers its health check.
 *
 * On free hosting the API sleeps after 15 idle minutes and takes a minute or
 * more to wake. Meanwhile a request may hang, time out, or get a holding page
 * instead of JSON, so only a real {"ok": true} counts as awake. `onSlow` is
 * called once if the wait passes `slowAfterMs`, so the page can explain it.
 */
export async function waitForApi({ onSlow, slowAfterMs = 2500, giveUpAfterMs = 240000 } = {}) {
  const started = Date.now();
  const slowTimer = setTimeout(() => onSlow?.(), slowAfterMs);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${API_URL}/api/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(30000),
        });
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (body?.ok === true) return;
      } catch {
        // Not up yet: refused, timed out, or not JSON.
      }
      if (Date.now() - started > giveUpAfterMs) {
        throw new ApiError("The server didn't start.", 503, "API_UNREACHABLE");
      }
      await sleep(Math.min(1000 * 2 ** attempt, 5000));
    }
  } finally {
    clearTimeout(slowTimer);
  }
}

async function parseBody(res) {
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function api(path, options = {}, { retry = true } = {}) {
  let res = await buildRequest(path, options, true);

  if (res.status === 401 && retry) {
    try {
      await refreshSession();
    } catch {
      clearAccessToken();
      onAuthFailure();
      throw new ApiError("Your session expired. Please log in again.", 401);
    }
    res = await buildRequest(path, options, true);
  }

  const body = await parseBody(res);

  if (!res.ok) {
    throw new ApiError(
      body?.error || `Request failed (${res.status})`,
      res.status,
      body?.code
    );
  }
  return body;
}

export { API_URL };
