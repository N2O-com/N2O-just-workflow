"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  HeartPulse,
  ListTodo,
  Network,
  Radio,
  Sparkles,
  PanelLeftOpen,
  PanelLeftClose,
} from "lucide-react";
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
  { href: "/ontology", icon: Network, label: "Ontology" },
] as const;

export function Sidebar({
  onAskToggle,
  expanded,
  onToggleExpanded,
}: {
  onAskToggle?: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={`flex h-screen flex-col border-r border-border bg-background py-3 transition-[width] duration-200 ${
        expanded ? "w-48" : "w-12"
      }`}
    >
      {/* Top toggle */}
      <div className={`mb-3 flex ${expanded ? "px-3 justify-end" : "justify-center"}`}>
        <button
          onClick={onToggleExpanded}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      {/* Nav items */}
      <div className={`flex flex-col gap-0.5 ${expanded ? "px-2" : "items-center"}`}>
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          const baseClasses = `flex items-center rounded-md transition-colors ${
            active
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`;

          if (expanded) {
            return (
              <Link
                key={href}
                href={href}
                className={`${baseClasses} gap-2.5 px-2.5 py-1.5 text-sm`}
              >
                <Icon size={17} />
                <span>{label}</span>
              </Link>
            );
          }

          return (
            <Tooltip key={href} delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  className={`${baseClasses} h-9 w-9 justify-center`}
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
      </div>

      {/* Ask button at bottom */}
      <div className={`mt-auto ${expanded ? "px-2" : "flex justify-center"}`}>
        {expanded ? (
          <button
            onClick={onAskToggle}
            className="flex w-full items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Sparkles size={17} />
            <span>Ask N2O</span>
          </button>
        ) : (
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
        )}
      </div>
    </aside>
  );
}
