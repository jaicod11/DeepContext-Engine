import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import IconSidebar from "@/components/layout/IconSidebar";
import Toast from "@/components/shared/Toast";
import UploadStatusWidget from "@/components/shared/UploadStatusWidget";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const DocumentChatPage = lazy(() => import("@/pages/DocumentChatPage"));
const DocumentsPage = lazy(() => import("@/pages/DocumentsPage"));
const ChatHistoryPage = lazy(() => import("@/pages/ChatHistoryPage"));
const InsightsPage = lazy(() => import("@/pages/InsightsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const MultiDocChatPage = lazy(() => import("@/pages/MultiDocChatPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));

function PageLoader() {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center",
      justifyContent: "center", color: "var(--text-muted)", fontSize: 13,
    }}>
      Loading…
    </div>
  );
}

export default function App() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const token = useAuthStore((s) => s.token);

  // ── Auth gate ─────────────────────────────────────────────────────────
  // No token → the ONLY thing that renders is the login screen. The
  // sidebar and every route are unreachable, so there's no window where
  // a protected page briefly mounts and fires unauthorised requests.
  if (!token) {
    return (
      <Suspense fallback={<PageLoader />}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <IconSidebar />

      <div className="page-content" style={{ position: "relative" }}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/history" element={<ChatHistoryPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/chat/compare" element={<MultiDocChatPage />} />
            <Route path="/chat" element={<DocumentChatPage />} />
            <Route path="/chat/:documentId" element={<DocumentChatPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>

      {toasts?.slice(-1).map((t) => (
        <Toast key={t.id} toast={t} onClose={() => dismissToast(t.id)} />
      ))}

      <UploadStatusWidget />
    </div>
  );
}