import { ReviewShell } from "@/components/layout/review-shell";

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <ReviewShell>{children}</ReviewShell>;
}
