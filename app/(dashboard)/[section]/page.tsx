import { notFound, redirect } from "next/navigation";

import { legacySectionRedirects } from "@/lib/navigation";

export default async function LegacySectionRoute({ params }: Readonly<{ params: Promise<{ section: string }> }>) {
  const { section } = await params;
  const destination = legacySectionRedirects[section];
  if (!destination) notFound();
  redirect(destination);
}
