import { auth } from "@clerk/nextjs/server";
import { AppHomePage } from "./_components/app-home-page";

export default async function ProtectedAppPage() {
  await auth.protect();

  return <AppHomePage />;
}
