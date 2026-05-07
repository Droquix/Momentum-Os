import { AppShell } from "@/components/app-shell";
import { getDemoDashboardSnapshot } from "@/lib/demo-data";

export default function HomePage() {
  const snapshot = getDemoDashboardSnapshot();
  return <AppShell snapshot={snapshot} />;
}
