/**
 * App.jsx
 * --------
 * Root layout component.
 *
 * Structure:
 *   <TopBar />
 *   <Sidebar />  |  <main: ChatInterface />  |  <CitationsPanel />
 *   <ToastContainer />
 *   <DocumentUpload modal />
 */

import { useState, lazy, Suspense } from "react";
import TopBar    from "@/components/layout/TopBar";
import Sidebar   from "@/components/layout/Sidebar";
import Toast     from "@/components/shared/Toast";
import { useAppStore } from "@/stores/appStore";

/* Lazy-load heavier panels to keep initial bundle small */
const ChatInterface   = lazy(() => import("@/components/chat/ChatInterface"));
const CitationsPanel  = lazy(() => import("@/components/shared/SourceCitations"));
const DocumentUpload  = lazy(() => import("@/components/documents/DocumentUpload"));

/* Fallback for lazy panels */
function PanelFallback() {
  return (
    <div style={{
      flex:           1,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      color:          "var(--text-tertiary)",
      fontSize:       12,
      fontFamily:     "var(--font-mono)",
    }}>
      Loading…
    </div>
  );
}

export default function App() {
  const citationPanelOpen = useAppStore((s) => s.citationPanelOpen);
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="app-shell">
      <TopBar />

      <div className="app-body">
        {/* Left — document sidebar */}
        <Sidebar onUploadClick={() => setUploadOpen(true)} />

        {/* Centre — chat */}
        <main className="main-content" role="main">
          <Suspense fallback={<PanelFallback />}>
            <ChatInterface onUploadClick={() => setUploadOpen(true)} />
          </Suspense>
        </main>

        {/* Right — citations panel */}
        <Suspense fallback={null}>
          <CitationsPanel />
        </Suspense>
      </div>

      {/* Global notifications */}
      <Toast />

      {/* Upload modal */}
      {uploadOpen && (
        <Suspense fallback={null}>
          <DocumentUpload onClose={() => setUploadOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
