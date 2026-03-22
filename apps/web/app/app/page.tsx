import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

export default async function ProtectedAppPage() {
  await auth.protect();

  return (
    <main>
      <h1>Protected app baseline</h1>
      <p>This route is protected by Clerk middleware and server auth checks.</p>
      <UserButton />
    </main>
  );
}
