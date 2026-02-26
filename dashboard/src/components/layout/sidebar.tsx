"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Eye,
  Gauge,
  Sparkles,
  Users,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const nav = [
  { href: "/", icon: Eye, label: "Observatory" },
  { href: "/velocity", icon: Gauge, label: "Velocity" },
  { href: "/skills", icon: Sparkles, label: "Skills" },
  { href: "/team", icon: Users, label: "Team" },
  { href: "/activity", icon: Activity, label: "Activity" },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-12 flex-col items-center border-r border-border bg-background py-3 gap-1">
      <div className="mb-3 text-xs font-bold text-primary tracking-wider">
        N2O
      </div>
      {nav.map(({ href, icon: Icon, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
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
    </aside>
  );
}
