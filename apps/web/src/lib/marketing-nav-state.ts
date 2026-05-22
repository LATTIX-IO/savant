export const MARKETING_NAV_SOLID_SCROLL_TOP = 24;

export function isMarketingNavSolid(scrollTop: number): boolean {
  return Number.isFinite(scrollTop) && scrollTop > MARKETING_NAV_SOLID_SCROLL_TOP;
}