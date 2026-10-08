// Whether a key press belongs to a control the user is typing in (page shortcuts stay out of it).

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'])

/** Arrow keys belong to the focused control only when it edits text (or is a select). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)
}
