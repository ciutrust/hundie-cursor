import { AppShellWrapper } from "@/components/layout/app-shell-wrapper";

export default function AmazonLayout({ children }: { children: React.ReactNode }) {
  return <AppShellWrapper>{children}</AppShellWrapper>;
}
