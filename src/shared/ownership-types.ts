export interface OwnershipMetric {
  count: number;
  percentage: number;
  total: number;
}

export interface RankedAuthor {
  author: string;
  files: OwnershipMetric;
  lines: OwnershipMetric;
  rank: number;
}

export type OwnershipReport =
  | { mode: "match"; patterns: string[]; files: OwnershipMetric; lines: OwnershipMetric }
  | { mode: "rank"; authors: RankedAuthor[]; files: number; lines: number };
