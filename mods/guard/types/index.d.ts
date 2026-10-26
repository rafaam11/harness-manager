export type GuardEnabled = boolean

declare module 'claude-code' {
  interface PluginState {
    guard: { isEnabled: GuardEnabled }
  }
}
