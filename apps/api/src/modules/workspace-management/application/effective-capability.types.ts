import type { EffectiveSubscriptionState } from "./effective-subscription.types";

export type EffectiveToolClassState = {
  allowed: boolean;
  quotaGoverned: boolean;
};

export type EffectiveCapabilityState = {
  schema: "persai.effectiveCapabilities.v1";
  derivedFrom: {
    planCode: string | null;
    planStatus: "active" | "inactive" | null;
    governanceSchema: string | null;
  };
  subscription: EffectiveSubscriptionState;
  toolClasses: {
    costDriving: EffectiveToolClassState;
    utility: EffectiveToolClassState;
  };
  channelsAndSurfaces: {
    webChat: boolean;
    telegram: boolean;
    whatsapp: boolean;
    max: boolean;
  };
  mediaClasses: {
    text: boolean;
    image: boolean;
    audio: boolean;
    video: boolean;
    file: boolean;
  };
};
