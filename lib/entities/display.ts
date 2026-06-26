export type EntityAccent = "orange" | "amber" | "cyan" | "emerald" | "rose";

export type EntityDisplayMeta = {
  subtitle: string;
  accent: EntityAccent;
};

const ENTITY_DISPLAY: Record<string, EntityDisplayMeta> = {
  keller: {
    subtitle: "Claudia 100% · JRoots + TatamiCRM",
    accent: "orange",
  },
  personal: {
    subtitle: "Mixed-use cards · household",
    accent: "amber",
  },
  "acaa-austin": {
    subtitle: "136 Anita · Schedule E",
    accent: "cyan",
  },
  gbsl: {
    subtitle: "Alex 100% · GB Southlake + Coppell",
    accent: "emerald",
  },
  pflugerville: {
    subtitle: "124 Joshua Tree · Schedule E",
    accent: "rose",
  },
};

export function getEntityDisplay(slug: string): EntityDisplayMeta {
  return (
    ENTITY_DISPLAY[slug] ?? {
      subtitle: "Entity ledger",
      accent: "emerald",
    }
  );
}

export const ENTITY_ACCENT_STYLES: Record<
  EntityAccent,
  { border: string; bar: string; badge: string; glow: string }
> = {
  orange: {
    border: "border-t-orange-500",
    bar: "bg-orange-500",
    badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    glow: "shadow-orange-500/5",
  },
  amber: {
    border: "border-t-amber-500",
    bar: "bg-amber-500",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    glow: "shadow-amber-500/5",
  },
  cyan: {
    border: "border-t-cyan-500",
    bar: "bg-cyan-500",
    badge: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    glow: "shadow-cyan-500/5",
  },
  emerald: {
    border: "border-t-emerald-500",
    bar: "bg-emerald-500",
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    glow: "shadow-emerald-500/5",
  },
  rose: {
    border: "border-t-rose-500",
    bar: "bg-rose-500",
    badge: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    glow: "shadow-rose-500/5",
  },
};
