// Activity: Full-screen activity page using the reusable ActivityPanel component.
"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ActivityPanel } from "@/components/activity/activity-panel";

export default function ActivityPage() {
  const router = useRouter();

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleMinimize = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <ActivityPanel
      mode="fullscreen"
      onClose={handleClose}
      onMinimize={handleMinimize}
    />
  );
}
