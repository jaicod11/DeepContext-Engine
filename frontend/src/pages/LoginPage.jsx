/**
 * pages/LoginPage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Combined login / signup screen. Shown whenever there's no valid token.
 */

import { useState } from "react";
import { Zap, Mail, Lock, User as UserIcon, ArrowRight, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

export default function LoginPage() {
    const [mode, setMode] = useState("login");   // "login" | "signup"
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");

    const login = useAuthStore((s) => s.login);
    const register = useAuthStore((s) => s.register);
    const isLoading = useAuthStore((s) => s.isLoading);
    const error = useAuthStore((s) => s.error);
    const clearError = useAuthStore((s) => s.clearError);

    const isSignup = mode === "signup";

    const handleSubmit = async () => {
        if (!email.trim() || !password) return;
        if (isSignup) {
            await register(email.trim(), password, fullName.trim());
        } else {
            await login(email.trim(), password);
        }
        // On success the store sets a token; App.jsx swaps this page out.
    };

    const handleKey = (e) => {
        if (e.key === "Enter") handleSubmit();
    };

    const switchMode = () => {
        clearError();
        setMode(isSignup ? "login" : "signup");
    };

    const canSubmit =
        email.trim().length > 0 &&
        password.length >= (isSignup ? 8 : 1) &&
        !isLoading;

    return (
        <div className="login-page">
            <div className="login-card">

                {/* Logo */}
                <div className="login-card__brand">
                    <div className="login-card__logo">
                        <Zap size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                        <h1 className="login-card__title">DeepContext Engine</h1>
                        <p className="login-card__subtitle">
                            {isSignup
                                ? "Create an account to start analysing documents"
                                : "Sign in to access your document library"}
                        </p>
                    </div>
                </div>

                {/* Form */}
                <div className="login-card__form">

                    {isSignup && (
                        <div className="login-field">
                            <label className="login-field__label">Full name</label>
                            <div className="login-field__input-wrap">
                                <UserIcon size={14} strokeWidth={2} color="var(--text-muted)" />
                                <input
                                    className="login-field__input"
                                    type="text"
                                    placeholder="Jaideep Kundu"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    onKeyDown={handleKey}
                                    autoComplete="name"
                                />
                            </div>
                        </div>
                    )}

                    <div className="login-field">
                        <label className="login-field__label">Email</label>
                        <div className="login-field__input-wrap">
                            <Mail size={14} strokeWidth={2} color="var(--text-muted)" />
                            <input
                                className="login-field__input"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onKeyDown={handleKey}
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    <div className="login-field">
                        <label className="login-field__label">Password</label>
                        <div className="login-field__input-wrap">
                            <Lock size={14} strokeWidth={2} color="var(--text-muted)" />
                            <input
                                className="login-field__input"
                                type="password"
                                placeholder={isSignup ? "At least 8 characters" : "••••••••"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={handleKey}
                                autoComplete={isSignup ? "new-password" : "current-password"}
                            />
                        </div>
                        {isSignup && password.length > 0 && password.length < 8 && (
                            <span className="login-field__hint">
                                Password must be at least 8 characters
                            </span>
                        )}
                    </div>

                    {error && <div className="login-error">{error}</div>}

                    <button
                        className="login-submit"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 size={14} strokeWidth={2.5} className="spin" />
                                {isSignup ? "Creating account…" : "Signing in…"}
                            </>
                        ) : (
                            <>
                                {isSignup ? "Create account" : "Sign in"}
                                <ArrowRight size={14} strokeWidth={2.5} />
                            </>
                        )}
                    </button>

                    <div className="login-switch">
                        {isSignup ? "Already have an account?" : "Don't have an account?"}
                        <button className="login-switch__btn" onClick={switchMode}>
                            {isSignup ? "Sign in" : "Sign up"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}