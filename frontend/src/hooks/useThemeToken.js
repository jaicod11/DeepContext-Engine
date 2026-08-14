/**
 * hooks/useThemeToken.js
 * ─────────────────────────────────────────────────────────────────────────
 * Resolve CSS custom properties to real colour strings for consumers that
 * cannot use var() — in practice, Recharts, which needs concrete values for
 * gradient stops and dot fills.
 *
 * Re-reads whenever the theme changes, so the chart actually re-colours on
 * toggle instead of keeping the colour it was first mounted with.
 */

import { useEffect, useState } from "react";
import { useThemeStore } from "@/stores/themeStore";

function readTokens(names) {
    if (typeof document === "undefined") return names.map(() => "");
    const styles = getComputedStyle(document.documentElement);
    return names.map((n) => styles.getPropertyValue(n).trim());
}

/**
 * @param  {...string} names CSS custom property names, e.g. "--primary"
 * @returns {string[]} resolved colour values, in the order requested
 */
export function useThemeToken(...names) {
    const theme = useThemeStore((s) => s.theme);
    const key = names.join(",");
    const [values, setValues] = useState(() => readTokens(names));

    useEffect(() => {
        // themeStore sets the [data-theme] attribute synchronously before this
        // effect runs, so the computed style is already the new theme's.
        setValues(readTokens(names));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme, key]);

    return values;
}
