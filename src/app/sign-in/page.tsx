"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseConfig } from "@/lib/env";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const authReady = useMemo(() => hasSupabaseConfig(), []);

  async function handleEmailAuth() {
    if (!authReady) {
      setMessage("Add Supabase environment variables to enable real account login and sync.");
      return;
    }

    setIsPending(true);
    setMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();

      if (mode === "sign_in") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        startTransition(() => router.push("/"));
        return;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName
          }
        }
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Account created. If email confirmation is enabled in Supabase, confirm it and then sign in.");
    } finally {
      setIsPending(false);
    }
  }

  async function handleGoogleAuth() {
    if (!authReady) {
      setMessage("Add Supabase environment variables to enable Google sign-in.");
      return;
    }

    setIsPending(true);
    setMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo
        }
      });

      if (error) {
        setMessage(error.message);
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-card__header">
          <Link href="/" className="auth-card__back">
            Back to workspace
          </Link>
          <p className="section-label">Account</p>
          <h1>Sign in to sync Momentum OS</h1>
          <p>
            A real account unlocks cloud sync, cross-device continuity, and shared access to your planning system.
          </p>
        </div>

        <div className="segmented-control auth-card__segmented" role="tablist" aria-label="Auth mode">
          <button type="button" className={mode === "sign_in" ? "is-active" : ""} onClick={() => setMode("sign_in")}>
            Sign in
          </button>
          <button type="button" className={mode === "sign_up" ? "is-active" : ""} onClick={() => setMode("sign_up")}>
            Create account
          </button>
        </div>

        <div className="auth-card__form">
          {mode === "sign_up" ? (
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Full name"
              autoComplete="name"
            />
          ) : null}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            autoComplete="email"
            type="email"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
            type="password"
          />
          <button type="button" className="auth-card__primary" onClick={handleEmailAuth} disabled={isPending}>
            {isPending ? "Working..." : mode === "sign_in" ? "Continue with email" : "Create account"}
          </button>
        </div>

        <div className="auth-card__divider">
          <span>or</span>
        </div>

        <button type="button" className="auth-card__google" onClick={handleGoogleAuth} disabled={isPending}>
          Continue with Google
        </button>

        <div className="auth-card__footer">
          <span className={authReady ? "auth-card__status is-ready" : "auth-card__status"}>
            {authReady ? "Supabase is configured for real auth." : "Supabase env vars are still missing in this deployment."}
          </span>
          {message ? <p>{message}</p> : null}
        </div>
      </section>
    </main>
  );
}
