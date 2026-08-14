import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
    Zap, LayoutDashboard, FileText, MessageSquare,
    Sparkles, Settings, User, Upload, LogOut,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

const NAV_ITEMS = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/documents", icon: FileText, label: "Documents" },
    { to: "/history", icon: MessageSquare, label: "Chat History" },
    { to: "/insights", icon: Sparkles, label: "Insights" },
    { to: "/settings", icon: Settings, label: "Settings" },
];

export default function IconSidebar() {
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const [menuOpen, setMenuOpen] = useState(false);

    const initials = (user?.full_name || user?.email || "?")
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

    return (
        <aside className="icon-sidebar">
            {/* Logo */}
            <div className="icon-sidebar__logo">
                <div className="icon-sidebar__logo-box">
                    <Zap size={18} strokeWidth={2.5} />
                </div>
                <span className="icon-sidebar__logo-label">Deep{"\n"}Context</span>
            </div>

            {/* Nav */}
            <nav className="icon-sidebar__nav">
                {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={to === "/"}
                        className={({ isActive }) =>
                            `icon-sidebar__nav-btn${isActive ? " active" : ""}`
                        }
                    >
                        <Icon size={18} strokeWidth={1.8} />
                        <span className="tooltip">{label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* Footer */}
            <div className="icon-sidebar__footer">
                <button
                    className="icon-sidebar__nav-btn"
                    onClick={() => navigate("/documents")}
                    title="Upload document"
                >
                    <Upload size={16} strokeWidth={1.8} />
                    <span className="tooltip">Upload</span>
                </button>

                {/* Avatar + account menu */}
                <div style={{ position: "relative" }}>
                    <button
                        className="icon-sidebar__avatar"
                        onClick={() => setMenuOpen((v) => !v)}
                        title={user?.email}
                        style={{
                            border: "none", cursor: "pointer",
                            fontSize: 11, fontWeight: 600,
                            color: "var(--text-secondary)",
                        }}
                    >
                        {initials || <User size={15} strokeWidth={1.8} />}
                    </button>

                    {menuOpen && (
                        <>
                            {/* Click-away backdrop */}
                            <div
                                style={{ position: "fixed", inset: 0, zIndex: 60 }}
                                onClick={() => setMenuOpen(false)}
                            />
                            <div className="account-menu">
                                <div className="account-menu__header">
                                    <div className="account-menu__name">
                                        {user?.full_name || "Account"}
                                    </div>
                                    <div className="account-menu__email">{user?.email}</div>
                                </div>
                                <button
                                    className="account-menu__item"
                                    onClick={() => { setMenuOpen(false); logout(); }}
                                >
                                    <LogOut size={13} strokeWidth={2} />
                                    Sign out
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </aside>
    );
}