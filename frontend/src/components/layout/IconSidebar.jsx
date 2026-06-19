import { NavLink, useNavigate } from "react-router-dom";
import {
    Zap,
    LayoutDashboard,
    FileText,
    MessageSquare,
    Sparkles,
    Settings,
    User,
    Upload,
} from "lucide-react";

const NAV_ITEMS = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/documents", icon: FileText, label: "Documents" },
    { to: "/history", icon: MessageSquare, label: "Chat History" },
    { to: "/insights", icon: Sparkles, label: "Insights" },
    { to: "/settings", icon: Settings, label: "Settings" },
];

export default function IconSidebar() {
    const navigate = useNavigate();

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
                {/* Quick upload shortcut → Documents page (real upload UI lives there) */}
                <button
                    className="icon-sidebar__nav-btn"
                    onClick={() => navigate("/documents")}
                    title="Upload document"
                >
                    <Upload size={16} strokeWidth={1.8} />
                    <span className="tooltip">Upload</span>
                </button>

                {/* Avatar */}
                <div className="icon-sidebar__avatar">
                    <User size={15} strokeWidth={1.8} />
                </div>
            </div>
        </aside>
    );
}