// Keyboard shortcut labels shared by the shortcut sheet and button tooltips.

/** Whether the modifier for shortcuts is ⌘ (Apple devices) rather than Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** "⌘" or "Ctrl". */
export function modKey(): string {
  return isApplePlatform() ? '⌘' : 'Ctrl'
}

/** The issue shortcut as shown to the user, e.g. "Ctrl+Enter". */
export function issueKeys(): string {
  return `${modKey()}+Enter`
}
