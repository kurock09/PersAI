import { auth } from "@clerk/nextjs/server";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { PricingPageView } from "../../_components/pricing-page-view";
import { fetchPublicPricingPlans } from "../../_server/fetch-public-pricing-plans";
import { fetchAppBootstrap } from "../_server/fetch-app-bootstrap";

export default async function AppPricingPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?${new URLSearchParams({ redirect_url: "/app/pricing" })}` as Route);
  }

  const [plans, bootstrap] = await Promise.all([fetchPublicPricingPlans(), fetchAppBootstrap()]);
  const currentPlanCode =
    bootstrap?.plan.ok === true ? bootstrap.plan.data.effectivePlan.code : null;

  return (
    <PricingPageView plans={plans} currentPlanCode={currentPlanCode} signedIn backHref="/app" />
  );
}
