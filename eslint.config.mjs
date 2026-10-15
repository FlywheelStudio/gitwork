// Lint config for packages/*. apps/web has its own (eslint-config-next).
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/**", "apps/**", "packages/db/migrations/**"]),
  ...tseslint.configs.recommended,
]);
