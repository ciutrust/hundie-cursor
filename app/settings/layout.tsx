import { AppShellWrapper } from "@/components/layout/app-shell-wrapper";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <AppShellWrapper>{children}</AppShellWrapper>;
}
