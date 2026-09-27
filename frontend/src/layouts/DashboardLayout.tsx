import { Outlet } from "react-router";
import { Sidebar } from "../components/layout/Sidebar";

export function DashboardLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
