import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");
await rm(outdir, { recursive: true, force: true });

const entrypoints = [...new Bun.Glob("src/**/*.html").scanSync()];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [tailwind],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

await Promise.all([
  Bun.write(path.join(outdir, "outbid-front-image.png"), Bun.file("public/outbid-front-image.png")),
  Bun.write(path.join(outdir, "outbid-back-image.png"), Bun.file("public/outbid-back-image.png")),
  Bun.write(path.join(outdir, "favicon.png"), Bun.file("public/favicon.png")),
  Bun.file(path.join(outdir, "index.html"))
    .text()
    .then(html =>
      Bun.write(
        path.join(outdir, "index.html"),
        html.includes("rel=\"icon\"") ? html : html.replace("</head>", "    <link rel=\"icon\" type=\"image/png\" href=\"/favicon.png\" />\n  </head>"),
      ),
    ),
]);

for (const output of result.outputs) {
  console.log(` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}
