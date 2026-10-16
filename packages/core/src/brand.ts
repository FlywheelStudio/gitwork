/** Product name. Change it here only (decision 015). */
export const APP_NAME = "Gitwork";

/** Suffix added to issue bodies and comments written by the App bot (decision 008). */
export function botAttribution(displayName: string): string {
  return `— ${displayName} via ${APP_NAME}`;
}

const TRAILING_ATTRIBUTION = new RegExp(`\\s*— [^\\n]+ via ${APP_NAME}\\s*$`);

/**
 * A bot-written issue body: the text, then one attribution line for the person who saved it.
 * An attribution line already at the end (an earlier bot save) is replaced, not stacked.
 */
export function withBotAttribution(body: string, displayName: string): string {
  const text = body.replace(TRAILING_ATTRIBUTION, "").trimEnd();
  return text ? `${text}\n\n${botAttribution(displayName)}` : botAttribution(displayName);
}
