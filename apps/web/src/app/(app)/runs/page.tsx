import type { Route } from "next";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { resolvePreferredTenantAppPath } from "@/server/control-plane/tenant-context";
export const metadata={title:"Runs"};
export default async function RunsPage(){
 const session=auth0?await auth0.getSession():null;
 const target=await resolvePreferredTenantAppPath(session?.user,"/runs");
 if(target)redirect(target as Route);
 redirect("/auth-status" as Route);
}
