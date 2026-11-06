/** Get the skills directory (supports --dir flag via env var). */
export function getSkillsDir(): string {
  return process.env.SKILLPM_DIR ?? ".skills";
}
