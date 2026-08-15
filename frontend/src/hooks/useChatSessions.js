/**
 * hooks/useChatSessions.js
 * ─────────────────────────────────────────────────────────────────────────
 * Chat history, backed by the SERVER rather than browser state — the same
 * move DocumentRecord made for the document library.
 *
 * The appStore `chatSessions` slice stays as a cache so the UI renders
 * instantly and keeps working mid-request, but on load the server wins.
 *
 * MIGRATION
 * Users from before this change have sessions only in localStorage. On the
 * first load per account, if the server returns nothing and local sessions
 * exist, the local ones are pushed up. It is marked done per user id, so it
 * runs once — not on every load, and not again on another device where the
 * server is already the source of truth.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import {
    clearChatSessions as apiClearAll,
    deleteChatSession as apiDeleteOne,
    listChatSessions,
    putChatSession,
} from "@/services/api";

const migrationKey = (userId) => `deepcontext-chat-migrated:${userId}`;

function alreadyMigrated(userId) {
    try {
        return localStorage.getItem(migrationKey(userId)) === "1";
    } catch (_) {
        return false;   // storage unavailable: skip migration rather than loop
    }
}

function markMigrated(userId) {
    try {
        localStorage.setItem(migrationKey(userId), "1");
    } catch (_) { /* ignore */ }
}

export function useChatSessions() {
    const chatSessions = useAppStore((s) => s.chatSessions);
    const setChatSessions = useAppStore((s) => s.setChatSessions);
    const clearLocal = useAppStore((s) => s.clearChatSessions);
    const removeLocal = useAppStore((s) => s.removeChatSession);
    const addToast = useAppStore((s) => s._addToast);

    const token = useAuthStore((s) => s.token);
    const userId = useAuthStore((s) => s.user?.id);

    // Guards against a second load racing the first (StrictMode mounts
    // effects twice in development).
    const loadingRef = useRef(false);

    const toMap = (list) =>
        Object.fromEntries(list.map((s) => [s.documentId, s]));

    const loadSessions = useCallback(async () => {
        if (!token || loadingRef.current) return;
        loadingRef.current = true;
        try {
            const remote = await listChatSessions();

            // One-time migration: server empty + local history present.
            const local = Object.values(useAppStore.getState().chatSessions ?? {})
                .filter((s) => s?.documentId && s.messages?.length > 0);

            if (remote.length === 0 && local.length > 0 && userId && !alreadyMigrated(userId)) {
                const results = await Promise.allSettled(
                    local.map((s) =>
                        putChatSession(s.documentId, {
                            filename: s.filename ?? "Untitled",
                            messages: s.messages,
                        })
                    )
                );
                const pushed = results.filter((r) => r.status === "fulfilled").length;
                // Only mark done if everything made it, so a partial failure
                // retries on the next load instead of silently losing history.
                if (pushed === local.length) markMigrated(userId);
                if (pushed > 0) {
                    addToast?.({
                        message: `Synced ${pushed} chat session${pushed === 1 ? "" : "s"} to your account.`,
                        type: "success",
                    });
                }
                setChatSessions(toMap(await listChatSessions()));
                return;
            }

            if (userId) markMigrated(userId);
            setChatSessions(toMap(remote));
        } catch (err) {
            if (!err?.isAxiosError) {
                console.error("[useChatSessions] loadSessions failed with a non-HTTP error:", err);
                throw err;
            }
            // 401 is handled globally by the axios interceptor (auto-logout).
            if (err.response?.status !== 401) {
                addToast?.({ message: "Could not load your chat history.", type: "error" });
            }
        } finally {
            loadingRef.current = false;
        }
    }, [token, userId, setChatSessions, addToast]);

    useEffect(() => {
        if (token) loadSessions();
    }, [token, loadSessions]);

    /** Clear every session for this account, server-side and locally. */
    const clearAll = useCallback(async () => {
        try {
            await apiClearAll();
            clearLocal();
            addToast?.({ message: "Chat history cleared.", type: "success" });
        } catch (err) {
            const detail =
                err?.response?.data?.detail || err?.message || "Could not clear chat history.";
            addToast?.({ message: detail, type: "error" });
        }
    }, [clearLocal, addToast]);

    const deleteOne = useCallback(async (documentId) => {
        try {
            await apiDeleteOne(documentId);
            removeLocal(documentId);
        } catch (err) {
            const detail =
                err?.response?.data?.detail || err?.message || "Could not delete that session.";
            addToast?.({ message: detail, type: "error" });
        }
    }, [removeLocal, addToast]);

    return { chatSessions, loadSessions, clearAll, deleteOne };
}
