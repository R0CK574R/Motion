const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

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
  // credentials: "include" is required for the httpOnly refresh cookie to be
  // sent cross-origin (frontend :5173 -> API :4000).
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
