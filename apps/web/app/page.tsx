import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const { userId } = await auth();
  if (userId !== null) {
    redirect("/app");
  }

  return (
    <main>
      <h1>PersAI</h1>
      <p>Sign in to open your assistant control surface.</p>
      <SignInButton mode="modal">
        <button type="button">Sign in with Clerk</button>
      </SignInButton>
    </main>
  );
}
