import { LandingSection } from "./section";
import { BlockProject } from "./demo/block-project";
import { BlockKnowledge } from "./demo/block-knowledge";
import { BlockMedia } from "./demo/block-media";

export async function LandingWorkflowSection() {
  return (
    <LandingSection id="workflow" className="pt-8 pb-16 sm:pt-12 sm:pb-24">
      <div className="flex flex-col gap-14 sm:gap-20">
        <BlockProject />
        <BlockKnowledge reversed />
        <BlockMedia />
      </div>
    </LandingSection>
  );
}
