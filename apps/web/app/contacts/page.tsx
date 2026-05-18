import { renderPublicSitePage } from "../_server/render-public-site-page";

export default async function ContactsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPublicSitePage("contacts", props.searchParams);
}
