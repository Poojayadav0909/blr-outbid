import { defineConfig, env } from "prisma/config";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("?)(.*?)\2\s*(#.*)?$/);
  if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[3];
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "bun prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});