export interface SetupProfile {
  id: string;
  name: string;
  root: string;
  localDir: string;
  kind: "builtin" | "local" | "linked" | "legacy";
  archived?: boolean;
}
export interface SetupProfiles { activeId: string; profiles: SetupProfile[] }

export const PROFILE_FILES = ["manifest/packages.json", "manifest/tools.json", "manifest/plugins.json", "manifest/mcp.json", "manifest/skills.json", "home/managed-keys.json", "home/agents/AGENTS.md", "home/claude/CLAUDE.md", "home/claude/settings.managed.json", "home/codex/config.managed.toml", "home/powershell/profile.ps1", "home/git/gitconfig.json", "home/components.v2.json"] as const;
export const PERSONAL_FILES = ["AGENTS.local.md", "claude-settings.local.json", "codex-config.local.json", "manifest.local.json", "powershell.local.ps1", "gitconfig.local.json"] as const;
export interface ProfileDocument {
  files: Record<string, string>;
  personal: Record<string, string>;
  portable: string[];
  privateTerms: string[];
}
export interface ProfileEditor { profile: SetupProfile; document: ProfileDocument; fingerprint: string }
export interface ProfileChange { file: string; diff: string }
export interface ProfilePreview { token: string; changes: ProfileChange[]; notes: string[] }
export interface ProfileBundle { format: "harness-manager-profile"; version: 1 | 2; name: string; files: Record<string, string>; personal: Record<string, string> }
export interface ProfileSyncStatus { connected: boolean; repository?: string; account?: string; detail: string; changed?: boolean; available: boolean }
export interface ProfileSyncPreview extends ProfilePreview { conflicts: string[]; direction: "send" | "receive" }
