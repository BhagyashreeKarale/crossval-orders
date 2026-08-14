"use client";

import { useAuth } from "@/components/AuthProvider";
import AuthPage from "@/components/AuthPage";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) return <AuthPage />;
  return <Dashboard />;
}
