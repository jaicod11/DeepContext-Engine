/**
 * stores/themeStore.js
 * ─────────────────────────────────────────────────────────────────────────
 * Two themes: "dark" (default) and "light".
 *
 * The theme is a single attribute on <html> — [data-theme="light"] — which
 * index.css uses to override the SAME design tokens :root defines. No
 * component reads this store to pick a colour; they all just use the CSS
 * variables and change automatically. The exception is the Recharts chart,
 * which needs a real colour string in JS (see hooks/useThemeToken.js).
 *
 * Deliberately NOT using zustand/persist: the value has to be applied to
 * <html> before first paint, which happens in a synchronous inline script in
 * index.html. That script owns the read; this store owns the writes. Both
 * use the key below, so they must stay in sync.
 */

import { create } from "zustand";

export const THEME_STORAGE_KEY = "deepcontext-theme";

/** Read whatever the pre-paint script already committed to <html>. */
function currentTheme() {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.getAttribute("data-theme") === "light"
        ? "light"
        : "dark";
}

function commit(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_) {
        /* private mode / storage disabled — theme still applies for this session */
    }
}

export const useThemeStore = create((set, get) => ({
    // Seeded from the DOM rather than a literal, so the store can never
    // disagree with what the user is actually looking at.
    theme: currentTheme(),

    setTheme: (theme) => {
        const next = theme === "light" ? "light" : "dark";
        commit(next);
        set({ theme: next });
    },

    toggleTheme: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        commit(next);
        set({ theme: next });
    },
}));
