import { renderPublicSitePage } from "../_server/render-public-site-page";

export default async function PrivacyPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPublicSitePage("privacy", props.searchParams);
}
