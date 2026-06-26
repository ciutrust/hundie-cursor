"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FilterOption = {
  id: string;
  label: string;
};

type FilterMultiSelectProps = {
  id: string;
  label: string;
  emptyLabel: string;
  options: FilterOption[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
};

function selectionLabel(options: FilterOption[], selectedIds: string[], emptyLabel: string): string {
  if (selectedIds.length === 0) {
    return emptyLabel;
  }

  const selected = options.filter((option) => selectedIds.includes(option.id));
  if (selected.length === 1) {
    return selected[0].label;
  }

  if (selected.length === 2) {
    return `${selected[0].label}, ${selected[1].label}`;
  }

  return `${selected[0].label} +${selected.length - 1} more`;
}

export function FilterMultiSelect({
  id,
  label,
  emptyLabel,
  options,
  selectedIds,
  onChange,
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    top: 0,
    left: 0,
    width: 256,
    openUp: false,
  });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  function updateMenuPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const maxMenuHeight = 256;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < maxMenuHeight && spaceAbove > spaceBelow;

    setMenuPosition({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 256),
      openUp,
    });
  }

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();

    function handleResize() {
      updateMenuPosition();
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function toggleOption(optionId: string) {
    if (selectedIds.includes(optionId)) {
      onChange(selectedIds.filter((item) => item !== optionId));
      return;
    }
    onChange([...selectedIds, optionId]);
  }

  if (options.length === 0) {
    return null;
  }

  const menu =
    open && mounted ? (
      <div
        ref={menuRef}
        role="listbox"
        aria-multiselectable
        style={{
          position: "fixed",
          top: menuPosition.top,
          left: menuPosition.left,
          width: menuPosition.width,
          zIndex: 100,
          transform: menuPosition.openUp ? "translateY(-100%)" : undefined,
        }}
        className="max-h-64 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
      >
        {options.map((option) => {
          const checked = selectedIds.includes(option.id);

          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={checked}
              onClick={() => toggleOption(option.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                checked && "bg-accent/60",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border",
                  checked && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {checked ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="min-w-0 flex-1">
      <Label htmlFor={id} className="mb-2 block text-sm font-medium">
        {label}
      </Label>
      <div ref={triggerRef}>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => {
            setOpen((current) => {
              const next = !current;
              if (next) updateMenuPosition();
              return next;
            });
          }}
          className="h-10 w-full justify-between font-normal"
        >
          <span className="truncate">{selectionLabel(options, selectedIds, emptyLabel)}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 opacity-50 transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {mounted && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
