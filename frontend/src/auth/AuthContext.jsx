import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  api,
  refreshSession,
  setAccessToken,
  clearAccessToken,
  setAuthFailureHandler,
} from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState({ status: "none" });
  // "loading" until we know whether the refresh cookie yields a session.
  const [status, setStatus] = useState("loading");

  const signOutLocally = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setSubscription({ status: "none" });
    setStatus("anon");
  }, []);

  const loadAccount = useCallback(async () => {
    const me = await api("/api/auth/me");
    setUser(me.user);
    setSubscription(me.subscription || { status: "none" });
    return me;
  }, []);

  // On mount: try to restore a session from the httpOnly refresh cookie.
  useEffect(() => {
    setAuthFailureHandler(signOutLocally);
    let cancelled = false;

    (async () => {
      try {
        await refreshSession();
        if (cancelled) return;
        await loadAccount();
        if (!cancelled) setStatus("authed");
      } catch {
        if (!cancelled) setStatus("anon");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signOutLocally, loadAccount]);

  const authenticate = useCallback(
    async (path, email, password) => {
      const data = await api(path, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAccessToken(data.accessToken);
      await loadAccount();
      setStatus("authed");
      return data;
    },
    [loadAccount]
  );

  const login = useCallback(
    (email, password) => authenticate("/api/auth/login", email, password),
    [authenticate]
  );

  const register = useCallback(
    (email, password) => authenticate("/api/auth/register", email, password),
    [authenticate]
  );

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the server call fails, drop local session state.
    }
    signOutLocally();
  }, [signOutLocally]);

  const value = {
    user,
    subscription,
    status,
    isSubscribed:
      subscription.status === "active" || subscription.status === "trialing",
    login,
    register,
    logout,
    refreshAccount: loadAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
