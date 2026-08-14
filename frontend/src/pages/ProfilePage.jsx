/**
 * ProfilePage.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Account details for the signed-in user: email, display name, when the
 * account was created, and how much data it holds.
 *
 * full_name is editable via PATCH /api/v1/auth/me. The update goes through
 * authStore.updateProfile, which writes the server's response back into the
 * store — so the sidebar avatar initials change immediately, no re-login.
 *
 * Password change and account deletion are deliberately out of scope.
 *
 * Reuses the settings-* layout classes rather than introducing a parallel
 * set, so this page inherits the same section/row rhythm as Settings.
 */

import { useState } from "react";
import { Check, Mail, Calendar, User as UserIcon } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useAppStore } from "@/stores/appStore";
import { useDocuments } from "@/hooks/useDocuments";

function formatJoined(value) {
    if (!value) return "—";
    // Postgres returns tz-aware ISO strings, SQLite naive ones. Treating a
    // naive value as UTC keeps the displayed date stable across both.
    const iso = /[Z+]|\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
        month: "long", day: "numeric", year: "numeric",
    });
}

export default function ProfilePage() {
    const user = useAuthStore((s) => s.user);
    const updateProfile = useAuthStore((s) => s.updateProfile);

    const chatSessions = useAppStore((s) => s.chatSessions);
    const addToast = useAppStore((s) => s._addToast);
    const { documents } = useDocuments();

    const [fullName, setFullName] = useState(user?.full_name ?? "");
    const [saving, setSaving] = useState(false);

    const sessionCount = Object.keys(chatSessions ?? {}).length;
    const dirty = (fullName.trim() || "") !== (user?.full_name ?? "");

    const handleSave = async () => {
        if (!dirty || saving) return;
        setSaving(true);
        try {
            await updateProfile({ fullName: fullName.trim() || null });
            addToast?.({ message: "Profile updated.", type: "success" });
        } catch (err) {
            const detail =
                err?.response?.data?.detail || err?.message || "Could not update profile.";
            addToast?.({ message: detail, type: "error" });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="settings-page">
            <div className="page-topbar">
                <h1>Profile</h1>
            </div>

            <div className="settings-page__body">

                {/* Account */}
                <div className="settings-section">
                    <div className="settings-section__header">
                        <div className="settings-section__title">Account</div>
                        <div className="settings-section__desc">
                            Your sign-in identity and display name
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">
                                <Mail size={12} strokeWidth={2} className="settings-row__icon" />
                                Email
                            </div>
                            <div className="settings-row__desc">
                                Used to sign in. Changing it isn't supported yet.
                            </div>
                        </div>
                        <div className="settings-row__control">
                            <span className="profile-value">{user?.email ?? "—"}</span>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">
                                <UserIcon size={12} strokeWidth={2} className="settings-row__icon" />
                                Display name
                            </div>
                            <div className="settings-row__desc">
                                Shown in the sidebar and account menu. Leave blank to clear it.
                            </div>
                        </div>
                        <div className="settings-row__control profile-name-control">
                            <input
                                className="settings-input settings-input--wide"
                                type="text"
                                placeholder="Your name"
                                value={fullName}
                                maxLength={255}
                                onChange={(e) => setFullName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                            />
                            <button
                                className="btn-primary profile-save-btn"
                                onClick={handleSave}
                                disabled={!dirty || saving}
                            >
                                <Check size={12} strokeWidth={2} />
                                {saving ? "Saving…" : "Save"}
                            </button>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-row__info">
                            <div className="settings-row__label">
                                <Calendar size={12} strokeWidth={2} className="settings-row__icon" />
                                Member since
                            </div>
                            <div className="settings-row__desc">
                                When this account was created
                            </div>
                        </div>
                        <div className="settings-row__control">
                            <span className="profile-value">{formatJoined(user?.created_at)}</span>
                        </div>
                    </div>
                </div>

                {/* Usage */}
                <div className="settings-section">
                    <div className="settings-section__header">
                        <div className="settings-section__title">Usage</div>
                        <div className="settings-section__desc">
                            What this account currently holds
                        </div>
                    </div>

                    <div className="settings-stat-row">
                        <div className="settings-stat-row__item">
                            <span className="settings-stat-row__value">{documents.length}</span>
                            <span className="settings-stat-row__label">Documents</span>
                        </div>
                        <div className="settings-stat-row__item">
                            <span className="settings-stat-row__value">{sessionCount}</span>
                            <span className="settings-stat-row__label">Chat Sessions</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
