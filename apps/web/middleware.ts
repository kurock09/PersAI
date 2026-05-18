import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/app(.*)",
  "/admin(.*)",
  "/api/assistant-file(.*)",
  // The BFF that streams Gamma's original PPTX export reads `auth().getToken()`
  // and forwards it as `Authorization: Bearer ...` to the API. Without
  // protected-route status Clerk would not run the full session check on the
  // standalone download tab, so `getToken()` could return a stale value the
  // API rejects with 401 — surfacing as "PPTX download unavailable" right
  // after click. Treat it the same as `/api/assistant-file(.*)`.
  "/api/assistant-document(.*)"
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
