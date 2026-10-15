/** Product name. Change it here only (decision 015). */
export const APP_NAME = "Gitwork";

/** Suffix added to issue bodies and comments written by the App bot (decision 008). */
export function botAttribution(displayName: string): string {
  return `— ${displayName} via ${APP_NAME}`;
}
