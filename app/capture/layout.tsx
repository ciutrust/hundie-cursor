import { AppShellWrapper } from "@/components/layout/app-shell-wrapper";

export default function CaptureLayout({ children }: { children: React.ReactNode }) {
  // lite: capture is the shoot-a-receipt screen - it must not block on badge counts,
  // and the sidebar (the only thing badges feed) is invisible on mobile anyway.
  return <AppShellWrapper variant="lite">{children}</AppShellWrapper>;
}
