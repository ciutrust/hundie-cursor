"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type EntityNavItem = {
  slug: string;
  name: string;
  unclassifiedCount?: number;
};

type SidebarEntitiesNavProps = {
  entities: EntityNavItem[];
};

export function SidebarEntitiesNav({ entities }: SidebarEntitiesNavProps) {
  const pathname = usePathname();
  const entitiesActive =
    pathname === "/review/entities" ||
    (pathname.startsWith("/review/") &&
      pathname !== "/review" &&
      pathname !== "/review/ai" &&
      !pathname.startsWith("/review/ai/"));
  const [open, setOpen] = useState(entitiesActive);

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-expanded={open}
          aria-label={open ? "Collapse entities" : "Expand entities"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Link
          href="/review/entities"
          className={cn(
            "flex flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
            pathname === "/review/entities"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          Entities
        </Link>
      </div>

      {open ? (
        <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
          {entities.map((entity) => {
            const href = `/review/${entity.slug}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={entity.slug}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="flex-1 truncate">{entity.name.split(",")[0]}</span>
                  {entity.unclassifiedCount != null && entity.unclassifiedCount > 0 ? (
                    <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-destructive">
                      {entity.unclassifiedCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
