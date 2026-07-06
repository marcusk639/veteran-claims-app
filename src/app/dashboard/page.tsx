import { currentUser } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  const user = await currentUser();
  return (
    <main>
      <h1>Dashboard</h1>
      <p data-testid="welcome">Welcome, {user?.firstName ?? "veteran"}.</p>
    </main>
  );
}
