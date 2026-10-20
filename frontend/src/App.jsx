import React, { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import { useAdaptiveTheme } from "./theme.js";
import AuthScreen from "./components/AuthScreen.jsx";
import Dashboard from "./components/Dashboard.jsx";
import { Backdrop, PageShell } from "./components/Backdrop.jsx";

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

  let screen;
  if (status === "loading") {
    screen = (
      <PageShell t={t} className="flex items-center justify-center">
        <div className={`rounded-xl border p-3 ${t.plaque}`}>
          <Loader2 className={`h-6 w-6 animate-spin ${t.muted}`} />
        </div>
      </PageShell>
    );
  } else if (status === "anon") {
    screen = <AuthScreen theme={theme} />;
  } else if (activating) {
    screen = (
      <PageShell t={t} className="flex items-center justify-center">
        <div className={`flex flex-col items-center gap-3 rounded-xl border px-8 py-6 ${t.plaque}`}>
          <CheckCircle2 className={`h-7 w-7 ${t.up}`} />
          <p className={`text-sm ${t.plaqueMuted}`}>Activating your subscription…</p>
        </div>
      </PageShell>
    );
  } else {
    screen = <Dashboard theme={theme} />;
  }

  // The backdrop lives here, outside the screens, so switching screens never
  // tears down and re-creates its WebGL context.
  return (
    <>
      <Backdrop t={t} />
      {screen}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
