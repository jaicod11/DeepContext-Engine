/**
 * stores/authStore.js
 * ─────────────────────────────────────────────────────────────────────────
 * Holds the JWT + current user. Persisted to localStorage so a page
 * refresh doesn't log you out.
 *
 * Kept SEPARATE from appStore deliberately: logging out must be able to
 * wipe auth state without touching (or being entangled with) chat
 * sessions, documents, settings, etc.
 *
 * NO GETTERS IN THIS STATE OBJECT.
 * persist()'s default merge is `{ ...currentState, ...persistedState }`.
 * Spreading INVOKES any getter, and it does so while the store is still
 * being constructed — at which point zustand's `get()` returns undefined.
 * A getter like `get isAuthenticated() { return Boolean(get().token) }`
 * therefore threw "Cannot read properties of undefined (reading 'token')"
 * during hydration. persist swallows that into its rehydrate callback, so
 * hydration silently aborted: hasHydrated() stayed false, the token was
 * never restored, and every refresh bounced the user to the login screen.
 * Derive values with a selector (see selectIsAuthenticated) instead.
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

            // True once persist() has finished reading localStorage. Until
            // then `token` is still null even for a signed-in user, so the app
            // must not conclude anything from it. Not persisted (partialize
            // drops it), so it always starts false on a fresh load.
            hasHydrated: false,

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

            /**
             * PATCH /auth/me — update the display name.
             *
             * Writes the server's response back into `user`, so anything
             * deriving from it (the sidebar avatar initials, the account
             * menu header) re-renders immediately without a re-login.
             * Throws on failure so the caller can surface the message.
             */
            updateProfile: async ({ fullName }) => {
                // Imported lazily: services/api.js imports THIS module for the
                // token, so a top-level import would be a circular dependency.
                const { updateProfile } = await import("@/services/api");
                const updated = await updateProfile({ fullName });
                set((s) => ({ user: { ...s.user, ...updated } }));
                return updated;
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

            onRehydrateStorage: () => (_state, error) => {
                if (error) {
                    // Don't let a storage problem strand the app on a spinner —
                    // log it and fall through to the login screen.
                    console.error("[authStore] rehydration failed:", error);
                }
                // This runs *during* create(), before `useAuthStore` is bound,
                // so defer to a microtask. It fires on both the success and the
                // failure path, which means the gate always opens.
                queueMicrotask(() => useAuthStore.setState({ hasHydrated: true }));
            },
        }
    )
);

/**
 * Derived auth flag. This replaces a `get isAuthenticated()` getter that
 * lived inside the store and broke hydration — see the note at the top.
 *
 *   const signedIn = useAuthStore(selectIsAuthenticated);
 */
export const selectIsAuthenticated = (s) => Boolean(s.token);

/** Read the token outside React (used by api.js interceptors). */
export const getAuthToken = () => useAuthStore.getState().token;