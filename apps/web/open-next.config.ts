import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache yet: every Gitwork page is dynamic and per-user.
export default defineCloudflareConfig();
