import { clerkFrontendApiProxy, createFrontendApiProxyHandlers } from "@clerk/nextjs/server";

export const { GET, POST, PUT, DELETE, PATCH } = createFrontendApiProxyHandlers({
  proxyPath: "/clerk-proxy"
});

export async function OPTIONS(request: Request) {
  return clerkFrontendApiProxy(request, { proxyPath: "/clerk-proxy" });
}
