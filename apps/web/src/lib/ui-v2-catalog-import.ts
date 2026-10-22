import type {RepositoryListItem} from "@savant/types";

/** Tenant-scoped inventory is returned by the authenticated API. Only repositories
 * whose provider supports proposals and Git writes can be import destinations.
 * The API still enforces repository authorization and proposal approval. */
export function eligibleCatalogImportRepositories(
 repositories:readonly RepositoryListItem[],
):RepositoryListItem[]{
 return repositories.filter(item=>item.providerReadiness.supportsProvisioningWrites);
}
export function initialCatalogImportRepositoryId(
 repositories:readonly RepositoryListItem[],
):string{
 const eligible=eligibleCatalogImportRepositories(repositories);
 return eligible.length===1?eligible[0]!.id:"";
}
export function canProposeCatalogImport(input:{
 repositories:readonly RepositoryListItem[];
 repositoryId:string;
 verdict:string;
 loading:boolean;
 proposalExists:boolean;
}):boolean{
 return !input.loading&&!input.proposalExists&&input.verdict!=="unsafe"&&
   eligibleCatalogImportRepositories(input.repositories).some(repo=>repo.id===input.repositoryId);
}
