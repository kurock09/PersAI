import { auth } from "@clerk/nextjs/server";
import { PricingPageView } from "../_components/pricing-page-view";
import { PublicAuthShell } from "../_components/public-auth-shell";
import { BackButtonBridge } from "../app/_components/back-button-bridge";
import { fetchAppBootstrap } from "../app/_server/fetch-app-bootstrap";
import { fetchPublicPricingPlans } from "../_server/fetch-public-pricing-plans";

export default async function PricingPage() {
  const plans = await fetchPublicPricingPlans();
  const session = await auth();
  const signedIn = session.userId !== null;
  const bootstrap = signedIn ? await fetchAppBootstrap() : null;
  const currentPlanCode =
    bootstrap?.plan.ok === true ? bootstrap.plan.data.effectivePlan.code : null;

  return (
    <>
      <BackButtonBridge />
      <PublicAuthShell
        showFooter
        showDownloadCta
        mainClassName="items-stretch justify-start py-4 sm:py-6"
      >
        <PricingPageView
          plans={plans}
          currentPlanCode={currentPlanCode}
          signedIn={signedIn}
          embedded
        />
      </PublicAuthShell>
    </>
  );
}
