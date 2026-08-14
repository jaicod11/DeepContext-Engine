/**
 * stores/authStore.js
 * ─────────────────────────────────────────────────────────────────────────
 * Holds the JWT + current user. Persisted to localStorage so a page
 * refresh doesn't log you out.
 *
 * Kept SEPARATE from appStore deliberately: logging out must be able to
 * wipe auth state without touching (or being entangled with) chat
 * sessions, documents, settings, etc.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

export const useAuthStore = create(
    persist(
        (set, get) => ({
            token: null,
            user: null,
            isLoading: false,
            error: null,

            get isAuthenticated() {
                return Boolean(get().token);
            },

            /** POST /auth/login */
            login: async (email, password) => {
                set({ isLoading: true, error: null });
                try {
                    const res = await fetch(`${BASE_URL}/auth/login`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email, password }),
                    });

                    const data = await res.json();

                    if (!res.ok) {
                        throw new Error(data?.detail || "Login failed.");
                    }

                    set({
                        token: data.access_token,
                        user: data.user,
                        isLoading: false,
                        error: null,
                    });
                    return true;
                } catch (err) {
                    set({ isLoading: false, error: err.message });
                    return false;
                }
            },

            /** POST /auth/register */
            register: async (email, password, fullName) => {
                set({ isLoading: true, error: null });
                try {
                    const res = await fetch(`${BASE_URL}/auth/register`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email,
                            password,
                            full_name: fullName || null,
                        }),
                    });

                    const data = await res.json();

                    if (!res.ok) {
                        // FastAPI validation errors come back as an array of objects
                        const detail = Array.isArray(data?.detail)
                            ? data.detail.map((d) => d.msg).join(", ")
                            : data?.detail;
                        throw new Error(detail || "Registration failed.");
                    }

                    set({
                        token: data.access_token,
                        user: data.user,
                        isLoading: false,
                        error: null,
                    });
                    return true;
                } catch (err) {
                    set({ isLoading: false, error: err.message });
                    return false;
                }
            },

            logout: () => {
                set({ token: null, user: null, error: null });
                // Clear per-user cached data so the next account doesn't inherit
                // the previous one's chat history / insights.
                try {
                    localStorage.removeItem("rag-app-store");
                } catch (_) { /* ignore */ }
            },

            clearError: () => set({ error: null }),
        }),
        {
            name: "deepcontext-auth",
            partialize: (s) => ({ token: s.token, user: s.user }),
        }
    )
);

/** Read the token outside React (used by api.js interceptors). */
export const getAuthToken = () => useAuthStore.getState().token;