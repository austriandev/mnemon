"use client";

import { ArrowRight, Eye, EyeOff, KeyRound } from "lucide-react";
import { useActionState, useState } from "react";
import { type SignInState, signIn } from "./actions.ts";

export function LoginForm({ closed }: { closed: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  const [shown, setShown] = useState(false);

  return (
    <form action={action} className="card login-card">
      <h1>Sign in</h1>
      <p className="lede">Enter the access code for this workspace.</p>
      <div style={{ display: "grid", gap: 18 }}>
        <label className="field">
          <span>Access code</span>
          <div className="underline">
            <KeyRound size={17} strokeWidth={2.25} />
            <input
              name="code"
              type={shown ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••••"
              required
              disabled={closed}
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "code-error" : undefined}
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => setShown((s) => !s)}
              aria-label={shown ? "Hide the code" : "Show the code"}
            >
              {shown ? (
                <EyeOff size={17} strokeWidth={2.25} />
              ) : (
                <Eye size={17} strokeWidth={2.25} />
              )}
            </button>
          </div>
        </label>
        {state.error ? (
          <p className="form-error" id="code-error" role="alert">
            {state.error}
          </p>
        ) : null}
        {closed ? (
          <p className="form-error" role="status">
            Sign-in is not configured on this server. Set MNEMON_ACCESS_CODE.
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={pending || closed}
          style={{ marginTop: 6 }}
        >
          {pending ? "Checking…" : "Continue"}
          {pending ? null : <ArrowRight size={17} strokeWidth={2.25} />}
        </button>
      </div>
    </form>
  );
}
