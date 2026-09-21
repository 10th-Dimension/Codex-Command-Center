import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// vinext/Wrangler may materialize a local helper beside the generated Worker
// config while loading development secrets. It is never a deployable asset.
// Remove only generated build artifacts; never touch the repository .env.local.
await rm(resolve("dist", "server", ".dev.vars"), { force: true });
// Turbopack can retain loaded dotenv values in its ignored cache. Clearing the
// exact cache after a Worker build keeps local artifacts from outliving the build.
await rm(resolve(".next", "cache"), { force: true, recursive: true });

const nextEnvPath = resolve("next-env.d.ts");
const nextEnv = await readFile(nextEnvPath, "utf8");
const newline = nextEnv.includes("\r\n") ? "\r\n" : "\n";
const stableLines = nextEnv
  .split(/\r?\n/)
  .filter((line) => !line.includes(".next/types/root-params.d.ts") && !line.includes("vinext/types/augmentations"));
const routeImportIndex = stableLines.findIndex((line) => line.includes(".next/types/routes.d.ts"));
stableLines.splice(routeImportIndex < 0 ? 2 : routeImportIndex, 0, 'import "vinext/types/augmentations";');
const stableNextEnv = stableLines.join(newline);
if (stableNextEnv !== nextEnv) await writeFile(nextEnvPath, stableNextEnv, "utf8");
