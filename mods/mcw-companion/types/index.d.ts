export type McwContext = {
  sessionId: string
  generation: string | null
  settingsPath: string | null
  briefPath: string | null
  project: string | null
  briefHead: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mcw-companion': {
      ctx: McwContext | null
    }
  }
}
