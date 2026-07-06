import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/app(.*)",
  "/admin(.*)",
  "/api/assistant-file(.*)",
  // The presentation PPTX BFF reads Clerk auth server-side and forwards a
  // Bearer token to the API, with a same-origin fresh-token fallback for
  // long-lived tabs. Treat it the same as `/api/assistant-file(.*)`.
  "/api/assistant-document(.*)",
  "/api/browser-login-live(.*)",
  "/api/internal/browser-login-live-upstream(.*)",
  "/api/support-attachment(.*)",
  "/api/admin-support-attachment(.*)",
  "/api/support-ticket(.*)"
]);
export const middlewareMatcherForTests = [
  "/((?!_next|clerk-proxy|api/(?:v1|health|ready)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  "/((?!api/(?:health|ready)).*)(api|trpc)(.*)"
];

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set("redirect_url", `${req.nextUrl.pathname}${req.nextUrl.search}`);
    await auth.protect({
      unauthenticatedUrl: signIn.toString()
    });
  }
});

export const config = {
  matcher: [
    "/((?!_next|clerk-proxy|api/(?:v1|health|ready)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/((?!api/(?:health|ready)).*)(api|trpc)(.*)"
  ]
};
