import React, { useEffect, useState } from "react";
import { Loader2, CheckCircle2, CloudOff } from "lucide-react";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import { useAdaptiveTheme } from "./theme.js";
import AuthScreen from "./components/AuthScreen.jsx";
import Dashboard from "./components/Dashboard.jsx";
import { Backdrop, PageShell } from "./components/Backdrop.jsx";
import { Intro } from "./components/Intro.jsx";

/**
 * Shown while a sleeping server wakes up. Free hosting stops the API after
 * 15 idle minutes, so the first visit after a quiet spell waits for it.
 */
function Waking({ t }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <PageShell t={t} className="flex items-center justify-center px-4">
      <div role="status" className={`max-w-sm rounded-lg border px-6 py-5 ${t.plaque}`}>
        <div className={`mb-2 flex items-center gap-2 ${t.heading}`}>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <h1 className="title text-lg">Starting the server</h1>
        </div>
        <p className={`text-sm leading-relaxed ${t.plaqueMuted}`}>
          Motion runs on free hosting, which sleeps when nobody is using it. Waking it up takes
          about a minute.
        </p>
        <p className={`mt-3 text-xs tabular-nums ${t.plaqueMuted}`}>{seconds} seconds</p>
      </div>
    </PageShell>
  );
}

function Unreachable({ t, onRetry }) {
  return (
    <PageShell t={t} className="flex items-center justify-center px-4">
      <div role="alert" className={`max-w-sm rounded-lg border px-6 py-5 ${t.plaque}`}>
        <div className={`mb-2 flex items-center gap-2 ${t.heading}`}>
          <CloudOff className="h-4 w-4 shrink-0" />
          <h1 className="title text-lg">Motion can't reach its server</h1>
        </div>
        <p className={`text-sm leading-relaxed ${t.plaqueMuted}`}>
          It may still be starting, or it may be down. Try again in a minute.
        </p>
        <button onClick={onRetry} className={`mt-4 rounded-md px-4 py-2 text-sm font-medium ${t.primaryBtn}`}>
          Try again
        </button>
      </div>
    </PageShell>
  );
}

const POLL_ATTEMPTS = 6;
const POLL_DELAY_MS = 1500;

function Shell() {
  const theme = useAdaptiveTheme();
  const { t } = theme;
  const { status, refreshAccount, retry } = useAuth();
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
  } else if (status === "waking") {
    screen = <Waking t={t} />;
  } else if (status === "unreachable") {
    screen = <Unreachable t={t} onRetry={retry} />;
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
  // tears down and re-creates its WebGL context. The intro sits above it all
  // and removes itself once it has played.
  return (
    <>
      <Backdrop t={t} />
      {screen}
      <Intro t={t} />
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
