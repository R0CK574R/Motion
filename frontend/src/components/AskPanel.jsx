import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Lock,
  MessageSquareText,
  SendHorizontal,
  ShieldCheck,
} from "lucide-react";
import { api } from "../api/client.js";

/** The line under every answer saying how far it can be trusted, and why. */
function Provenance({ result, t }) {
  const { checks, sources = [], sample, model, usage } = result;
  return (
    <div className={`mt-3 space-y-1.5 border-t pt-3 text-xs ${t.toggleShell}`}>
      {checks.grounded ? (
        <div className={`flex items-center gap-1.5 ${t.up}`}>
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          {sample
            ? "Sample answer: filled in from your data, without calling the AI model."
            : "Every figure was checked against your data."}
        </div>
      ) : (
        <div className={`flex items-start gap-1.5 ${t.riskHead}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Unverified: {checks.ungroundedFigures.join(", ")} could not be matched to your data.
            Treat {checks.ungroundedFigures.length === 1 ? "that figure" : "those figures"} with
            caution.
          </span>
        </div>
      )}
      {sources.length > 0 && (
        <div className={t.faint}>Figures from: {sources.map((s) => s.label).join(" · ")}</div>
      )}
      {!sample && model && (
        <div className={`font-mono ${t.faint}`}>
          {model} · {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens
        </div>
      )}
    </div>
  );
}

/**
 * "Ask your portfolio" and the risk memo. The server decides what this user
 * may do (live answers, sample answers for the demo, or nothing without a
 * subscription); this component only reflects it.
 */
export default function AskPanel({ t }) {
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState(null);
  const [memo, setMemo] = useState(null);
  const [busy, setBusy] = useState(""); // "", "ask" or "memo"
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api("/api/ai/status")
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ mode: "unavailable", suggestions: [] }); });
    return () => { cancelled = true; };
  }, []);

  async function ask(text) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy("ask");
    setError("");
    setAsked(q);
    setAnswer(null);
    try {
      setAnswer(await api("/api/ai/ask", { method: "POST", body: JSON.stringify({ question: q }) }));
      setQuestion("");
    } catch (err) {
      setError(err.message || "Could not get an answer.");
    } finally {
      setBusy("");
    }
  }

  async function writeMemo() {
    if (busy) return;
    setBusy("memo");
    setError("");
    try {
      setMemo(await api("/api/ai/memo", { method: "POST" }));
    } catch (err) {
      setError(err.message || "Could not write the memo.");
    } finally {
      setBusy("");
    }
  }

  if (!status) return null;

  const card = `rounded-xl border p-5 transition-colors duration-500 ${t.card}`;
  const usable = status.mode === "live" || status.mode === "sample";

  return (
    <div className="mt-6">
      <section className={card}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className={`flex items-center gap-2 ${t.heading}`}>
            <MessageSquareText className="h-4 w-4" />
            <h2 className="text-sm font-medium">Ask your portfolio</h2>
          </div>
          {status.mode === "sample" && (
            <span className={`rounded-md border px-2 py-0.5 text-xs ${t.demoBadge}`}>Sample answers</span>
          )}
        </div>

        {!usable ? (
          <p className={`flex items-center gap-2 text-sm ${t.muted}`}>
            <Lock className="h-4 w-4 shrink-0" />
            {status.mode === "locked"
              ? "Asking questions in plain English is part of the subscription."
              : "The AI service isn't set up on this server."}
          </p>
        ) : (
          <>
            <p className={`mb-3 text-xs leading-relaxed ${t.muted}`}>
              {status.mode === "sample"
                ? "The demo answers these questions from your portfolio data without calling the AI model. With an account you can ask anything in your own words."
                : "Answers are written by an AI model that can only read your positions, transactions and risk figures. It describes; it does not give advice."}
            </p>

            <div className="mb-3 flex flex-wrap gap-2">
              {(status.suggestions || []).map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  disabled={!!busy}
                  className={`rounded-full border px-3 py-1 text-xs transition disabled:opacity-40 ${t.ghostBtn}`}
                >
                  {s}
                </button>
              ))}
            </div>

            {status.mode === "live" && (
              <form
                onSubmit={(e) => { e.preventDefault(); ask(question); }}
                className="flex gap-2"
              >
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={500}
                  placeholder="How much of my risk comes from technology?"
                  aria-label="Your question"
                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm transition-colors duration-500 focus:outline-none focus:ring-2 ${t.input}`}
                />
                <button
                  type="submit"
                  disabled={!question.trim() || !!busy}
                  aria-label="Ask"
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${t.primaryBtn}`}
                >
                  <SendHorizontal className="h-4 w-4" />
                </button>
              </form>
            )}

            {busy === "ask" && (
              <div className={`mt-4 flex items-center gap-2 text-sm ${t.muted}`}>
                <Loader2 className="h-4 w-4 animate-spin" /> Reading your portfolio…
              </div>
            )}

            {answer && (
              <div className="mo-fade mt-4" data-testid="ai-answer">
                <div className={`mb-1 text-xs ${t.faint}`}>{asked}</div>
                <p className={`whitespace-pre-line text-sm leading-relaxed ${t.body}`}>{answer.answer}</p>
                <Provenance result={answer} t={t} />
              </div>
            )}

            <div className={`mt-4 flex items-center justify-between gap-3 border-t pt-4 ${t.toggleShell}`}>
              <span className={`text-xs ${t.muted}`}>
                A one-page summary of concentration, risk and stress tests.
              </span>
              <button
                onClick={writeMemo}
                disabled={!!busy}
                className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-40 ${t.ghostBtn}`}
              >
                {busy === "memo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Write risk memo
              </button>
            </div>
          </>
        )}

        {error && (
          <div role="alert" className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {memo && (
        <section className={`mo-fade mt-6 ${card}`} data-testid="ai-memo">
          <h2 className={`mb-4 text-base font-semibold ${t.heading}`}>{memo.title}</h2>
          <div className="space-y-4">
            {memo.sections.map((s) => (
              <div key={s.heading}>
                <h3 className={`mb-1 text-xs font-medium uppercase tracking-wide ${t.faint}`}>{s.heading}</h3>
                <p className={`text-sm leading-relaxed ${t.body}`}>{s.body}</p>
              </div>
            ))}
          </div>
          <Provenance result={memo} t={t} />
        </section>
      )}
    </div>
  );
}
