import type { Instrumentation } from "next";

/** Next.js calls this for every unhandled server error (routes, pages, server actions). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/server/observability/errors");
  const source = context.routeType === "render" ? "render" : context.routeType === "route" ? "route" : context.routeType === "action" ? "action" : "server";
  await recordError(error, { source, route: request.path });
};
