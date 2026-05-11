import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/app(.*)", "/admin(.*)", "/api/assistant-file(.*)"]);
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
