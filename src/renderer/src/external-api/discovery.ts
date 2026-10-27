import Fuse from "fuse.js";
import type { Source } from "@shared/external-api/schema";

export type SourceFilters = {
  query?: string;
  domain?: string;
  delivery?: string;
  auth?: string;
  realtime?: string;
  geography?: string;
  technologyNames?: Record<string, string>;
};

export function filterSources(sources: Source[], filters: SourceFilters): Source[] {
  let matches = sources;
  const query = filters.query?.trim();
  if (query) {
    const documents = sources.map((source) => ({
      source,
      technologies: source.technologyIds.map((technologyId) => filters.technologyNames?.[technologyId] ?? technologyId).join(" "),
    }));
    const fuse = new Fuse(documents, {
      threshold: 0.35,
      ignoreLocation: true,
      keys: ["source.name", "source.summary", "source.keywords", "source.data.name", "source.data.fields", "technologies"],
    });
    matches = fuse.search(query).map(({ item }) => item.source);
  }

  return matches.filter((source) =>
    (!filters.domain || source.domains.includes(filters.domain))
    && (!filters.delivery || source.delivery.includes(filters.delivery as Source["delivery"][number]))
    && (!filters.auth || source.auth === filters.auth)
    && (!filters.realtime || source.realtime === filters.realtime)
    && (!filters.geography || source.geography.includes(filters.geography as Source["geography"][number])),
  );
}

export function addToComparison(current: string[], sourceId: string): string[] {
  if (current.includes(sourceId) || current.length >= 4) return current;
  return [...current, sourceId];
}

export function removeFromComparison(current: string[], sourceId: string): string[] {
  return current.filter((id) => id !== sourceId);
}
