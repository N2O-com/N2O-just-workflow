"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, HeartPulse, ListTodo, Radio, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const nav = [
  { href: "/streams", icon: Radio, label: "Streams" },
  { href: "/tasks", icon: ListTodo, label: "Tasks" },
  { href: "/activity", icon: Activity, label: "Activity" },
  { href: "/health", icon: HeartPulse, label: "Health" },
] as const;

export function Sidebar({ onAskToggle }: { onAskToggle?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-12 flex-col items-center border-r border-border bg-background py-3 gap-1">
      <div className="mb-3 h-4" />
      {nav.map(({ href, icon: Icon, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Tooltip key={href} delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                href={href}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon size={18} />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {label}
            </TooltipContent>
          </Tooltip>
        );
      })}
      <div className="mt-auto">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={onAskToggle}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Sparkles size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Ask N2O
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
