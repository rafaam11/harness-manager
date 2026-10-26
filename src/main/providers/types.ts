import type { NormalizedConfigFile, ProviderId } from "@shared/provider-types";
import type { CatalogItem } from "../services/catalog.js";
import type { McpServer } from "../services/mcp.js";

export interface ProviderRoots {
  home: string;
  configFiles: string[];
  appData?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  roots: ProviderRoots;
  listConfigFiles(): Promise<NormalizedConfigFile[]>;
  readMcpServers(): Promise<McpServer[]>;
  listCatalog(): Promise<CatalogItem[]>;
  detectRunning(): Promise<boolean>;
}
