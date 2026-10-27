export interface SetupProfile {
  id: string;
  name: string;
  root: string;
  localDir: string;
  kind: "builtin" | "local" | "linked" | "legacy";
}
export interface SetupProfiles { activeId: string; profiles: SetupProfile[] }
