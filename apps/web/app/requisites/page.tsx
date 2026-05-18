import { renderPublicSitePage } from "../_server/render-public-site-page";

export default async function RequisitesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPublicSitePage("requisites", props.searchParams);
}
