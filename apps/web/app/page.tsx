import Link from "next/link";
import { SignInButton, SignOutButton, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

export default async function HomePage() {
  const { userId } = await auth();

  return (
    <main>
      <h1>PersAI v2 Foundation</h1>
      <p>Step 2 slice 1: Clerk login/logout + protected route baseline.</p>
      {userId === null ? (
        <SignInButton mode="modal">
          <button type="button">Sign in with Clerk</button>
        </SignInButton>
      ) : (
        <>
          <p>
            Signed in. Continue to the protected app area: <Link href="/app">/app</Link>
          </p>
          <UserButton />
          <SignOutButton>
            <button type="button">Sign out</button>
          </SignOutButton>
        </>
      )}
    </main>
  );
}
