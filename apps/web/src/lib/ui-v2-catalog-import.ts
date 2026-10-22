import type {RepositoryListItem} from "@savant/types";

/** Tenant-filtered inventory is returned by the authenticated API; this helper
 * only selects an eligible destination and never grants repository access. */
export function eligibleCatalogImportRepositories(
 repositories:readonly RepositoryListItem[],
):RepositoryListItem[]{
 return repositories.filter(item=>item.status!=="disabled");
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
