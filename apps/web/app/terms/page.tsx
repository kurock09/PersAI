import { renderPublicSitePage } from "../_server/render-public-site-page";

export default async function TermsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPublicSitePage("terms", props.searchParams);
}
