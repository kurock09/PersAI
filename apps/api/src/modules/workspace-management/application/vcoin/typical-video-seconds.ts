/**
 * ADR-108 Slice 6a — typical video length heuristic used for the
 * "≈ N videos / month" marketing approximation on both the admin UI
 * (Slice 5, `apps/web/app/admin/plans/page.tsx`) and the server-side
 * `PublicPricingPlanState.videoVcoinApproxVideosPerMonth` projection.
 *
 * **Value MUST be 5** to match the Slice 5 admin UI constant.  If you
 * need to change this, update both locations together and bump the ADR.
 *
 * Used in:
 *   - `manage-admin-plans.service.ts` → `listPublicPricingPlans()`
 */
export const TYPICAL_VIDEO_SECONDS = 5;
