/**
 * components/shared/Toast.jsx
 * ----------------------------
 * Notification toasts rendered in the bottom-right corner.
 * Consumed directly from appStore — no props needed.
 */

import { CheckCircle, XCircle, Info, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

const ICONS = {
  success: <CheckCircle size={14} style={{ color: "var(--text-success)", flexShrink: 0 }} />,
  error:   <XCircle     size={14} style={{ color: "var(--text-error)",   flexShrink: 0 }} />,
  info:    <Info        size={14} style={{ color: "var(--accent)",        flexShrink: 0 }} />,
};

export default function ToastContainer() {
  const toasts       = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.type}`} role="alert">
          {ICONS[toast.type] ?? ICONS.info}
          <span style={{ flex: 1, color: "var(--text-primary)" }}>{toast.message}</span>
          <button
            onClick={() => dismissToast(toast.id)}
            style={{ color: "var(--text-tertiary)", display: "flex", alignItems: "center" }}
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
