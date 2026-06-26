type DormantEntity = {
  name: string;
  slug: string;
  status: string | null;
};

export function DormantEntitiesCard({ entities }: { entities: DormantEntity[] }) {
  if (entities.length === 0) return null;

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">Dormant entities</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {entities.map((entity) => entity.name.split(",")[0]?.trim() ?? entity.name).join(" · ")}
      </p>
      <p className="mt-2 text-xs text-muted-foreground/80">
        Registry only — not classifiable until activated.
      </p>
    </div>
  );
}
