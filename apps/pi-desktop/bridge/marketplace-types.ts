/** Public package metadata, never package code or instructions to execute. */
export type MarketplaceKind = 'extension' | 'skill'
export type PackageResourceType = MarketplaceKind | 'prompt' | 'theme'
export type MarketplaceSort = 'downloads' | 'recent' | 'name'
export interface MarketplaceQuery { kind: MarketplaceKind; query: string; sort: MarketplaceSort; page: number }
export interface MarketplacePackage {
  name: string
  description: string
  author: string
  downloads: number
  types: PackageResourceType[]
  url: string
}
export interface MarketplacePage { packages: MarketplacePackage[]; total: number; page: number; hasNext: boolean; url: string }
export interface MarketplaceDetail {
  name: string
  version: string
  description: string
  license: string
  resources: { type: PackageResourceType; paths: string[] }[]
  piRequirement?: string
  homepage?: string
  url: string
}
