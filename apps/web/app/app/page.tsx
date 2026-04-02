import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHomePage } from "./_components/app-home-page";

export default async function ProtectedAppPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?${new URLSearchParams({ redirect_url: "/app" })}`);
  }

  return <AppHomePage />;
}
