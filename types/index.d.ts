export type MemoItem = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-memo': {
      items: StateFamily<MemoItem[]>
      draft: StateFamily<string>
      editingId: StateFamily<string | null>
      selected: StateFamily<string[]>
      isCollapsed: StateFamily<boolean>
      expanded: StateFamily<string[]>
    }
  }
}
