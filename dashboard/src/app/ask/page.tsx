"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { AskFullscreenPage } from "@/components/ask-panel";

export default function AskPage() {
  const router = useRouter();

  // Go back with panel open — uses sessionStorage flag
  const handleMinimize = useCallback(() => {
    sessionStorage.setItem("n2o-ask-panel-open", "true");
    router.back();
  }, [router]);

  // Close = same as minimize (go back, panel stays open)
  const handleClose = useCallback(() => {
    sessionStorage.setItem("n2o-ask-panel-open", "true");
    router.back();
  }, [router]);

  return <AskFullscreenPage onClose={handleClose} onMinimize={handleMinimize} />;
}
