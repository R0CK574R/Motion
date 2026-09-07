import React, { useState } from "react";
import { Aperture, Loader2, AlertTriangle } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { ThemeToggle } from "./Chrome.jsx";

export default function AuthScreen({ theme }) {
  const { mode, setMode, resolved, t } = theme;
  const { login, register } = useAuth();

  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    // Mirrors the backend's minimum so users get the error before a round trip.
    if (isRegister && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      if (isRegister) await register(email, password);
      else await login(email, password);
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputBase =
    "w-full rounded-lg border px-3 py-2.5 text-sm transition-colors duration-500 focus:outline-none focus:ring-2";

  return (
    <div className={`min-h-screen font-sans transition-colors duration-500 ${t.page}`}>
      <style>{`input::placeholder { color: ${t.placeholder}; }`}</style>

      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-500 ${t.logo}`}
            >
              <Aperture className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Motion</h1>
              <p className={`text-sm ${t.muted}`}>Portfolio analytics.</p>
            </div>
          </div>
          <ThemeToggle mode={mode} setMode={setMode} resolved={resolved} t={t} />
        </div>

        <div className={`rounded-xl border p-6 transition-colors duration-500 ${t.card}`}>
          <h2 className={`mb-1 text-lg font-medium ${t.heading}`}>
            {isRegister ? "Create your account" : "Welcome back"}
          </h2>
          <p className={`mb-5 text-sm ${t.muted}`}>
            {isRegister
              ? "Your portfolio is private to your account."
              : "Sign in to see your portfolio."}
          </p>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className={`mb-1 block text-xs font-medium ${t.muted}`} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={`${inputBase} ${t.input}`}
              />
            </div>

            <div>
              <label className={`mb-1 block text-xs font-medium ${t.muted}`} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? "At least 8 characters" : "••••••••"}
                className={`${inputBase} ${t.input}`}
              />
            </div>

            {error && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition disabled:opacity-60 ${t.primaryBtn}`}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isRegister ? "Create account" : "Sign in"}
            </button>
          </form>

          <button
            onClick={() => {
              setIsRegister((v) => !v);
              setError("");
            }}
            className={`mt-4 w-full text-center text-sm transition ${t.muted} hover:underline`}
          >
            {isRegister
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        </div>

        <p className={`mt-6 text-center text-xs leading-relaxed ${t.faint}`}>
          Motion is an analytics tool, not investment advice. It describes what a
          portfolio is made of — it never tells you what to buy, sell, or hold.
        </p>
      </div>
    </div>
  );
}
