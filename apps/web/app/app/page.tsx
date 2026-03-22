import { auth } from "@clerk/nextjs/server";
import { AppFlowClient } from "./app-flow.client";

export default async function ProtectedAppPage() {
  await auth.protect();

  return <AppFlowClient />;
}
