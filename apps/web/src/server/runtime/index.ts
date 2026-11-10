// Resolves to runtime.node.ts or runtime.workerd.ts at build time (see next.config.ts).
export {
  bootNode,
  DEFAULT_TRUSTED_IP_HEADER,
  getDatabase,
  getEmailSender,
  getEnv,
  RUNTIME,
  startScheduler,
} from "@gitwork/runtime";
