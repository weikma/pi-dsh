/** Read-only projection of Pi 0.99.1's native expanded skill messages. Unknown formats remain plain text. */
export interface SkillInvocation { name: string; location: string; content: string; prompt: string }
export function skillInvocation(text: string): SkillInvocation | undefined {
  const match = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/u.exec(text)
  if (!match) return undefined
  return { name: match[1]!, location: match[2]!, content: match[3]!, prompt: match[4]?.trim() ?? '' }
}

/** A discovered chat title describes the user's request while native history retains the complete skill. */
export function userMessageTitle(text: string): string {
  const skill = skillInvocation(text)
  return (skill ? skill.prompt || '/skill:' + skill.name : text).slice(0, 120)
}
