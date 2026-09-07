import React, { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import { useAdaptiveTheme } from "./theme.js";
import AuthScreen from "./components/AuthScreen.jsx";
import Dashboard from "./components/Dashboard.jsx";

const POLL_ATTEMPTS = 6;
const POLL_DELAY_MS = 1500;

function Shell() {
  const theme = useAdaptiveTheme();
  const { t } = theme;
  const { status, refreshAccount } = useAuth();
  const [activating, setActivating] = useState(false);

  /**
   * Stripe redirects back the instant checkout completes, but the webhook that
   * marks the subscription active is a separate request that may not have
   * landed yet. Poll briefly rather than showing a paywall to someone who just
   * paid.
   */
  useEffect(() => {
    if (status !== "authed") return undefined;

    const params = new URLSearchParams(window.location.search);
    if (!params.has("session_id")) return undefined;

    let cancelled = false;
    setActivating(true);

    (async () => {
      for (let i = 0; i < POLL_ATTEMPTS && !cancelled; i++) {
        try {
          const me = await refreshAccount();
          const s = me?.subscription?.status;
          if (s === "active" || s === "trialing") break;
        } catch {
          // keep polling; a transient failure shouldn't end the wait
        }
        await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
      }
      if (cancelled) return;
      // Clean the URL so a refresh doesn't re-trigger this.
      window.history.replaceState({}, "", window.location.pathname);
      setActivating(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [status, refreshAccount]);

  if (status === "loading") {
    return (
      <div className={`flex min-h-screen items-center justify-center font-sans ${t.page}`}>
        <Loader2 className={`h-6 w-6 animate-spin ${t.muted}`} />
      </div>
    );
  }

  if (status === "anon") return <AuthScreen theme={theme} />;

  if (activating) {
    return (
      <div
        className={`flex min-h-screen flex-col items-center justify-center gap-3 font-sans ${t.page}`}
      >
        <CheckCircle2 className={`h-7 w-7 ${t.up}`} />
        <p className={`text-sm ${t.muted}`}>Activating your subscription…</p>
      </div>
    );
  }

  return <Dashboard theme={theme} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
