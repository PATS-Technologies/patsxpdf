import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import Workbench from "@/components/Workbench";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <Workbench user={user} />;
}

