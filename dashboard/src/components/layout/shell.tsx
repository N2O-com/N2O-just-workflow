"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { AskPanel } from "@/components/ask-panel";

export function Shell({ children }: { children: React.ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar onAskToggle={() => setAskOpen((o) => !o)} />
      <main
        className={`flex-1 overflow-y-auto p-4 transition-[margin] ${
          askOpen ? "mr-[350px]" : ""
        }`}
      >
        {children}
      </main>
      <div className="fixed right-0 top-0 z-50">
        <AskPanel open={askOpen} onClose={() => setAskOpen(false)} />
      </div>
    </div>
  );
}
