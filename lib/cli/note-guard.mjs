/**
 * Advisory checks for task descriptions.
 *
 * A task description should say *what to do and how it is accepted* in a
 * couple of sentences. Long prose belongs in `context decision`, which is
 * append-only and does not get rewritten every time someone touches the task.
 * These checks only warn; they never block a create.
 */

export const NOTE_SOFT_LIMIT = 300

/** @returns {string[]} human-readable warnings, empty when the note is fine */
export function noteWarnings(notes) {
  if (typeof notes !== 'string') return []
  const length = notes.trim().length
  if (length <= NOTE_SOFT_LIMIT) return []
  return [
    `描述 ${length} 字，超过建议上限 ${NOTE_SOFT_LIMIT} 字：notes 只写「做什么 + 验收标准」，过程与结论建议写进 context decision（追加式，不会被覆盖）`,
  ]
}

/** Print helper shared by the two create entry points. */
export function emitNoteWarnings(warnings, write) {
  for (const warning of warnings) write(`⚠ ${warning}`)
}
