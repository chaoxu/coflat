#!/usr/bin/env node
// Standalone LaTeX export CLI documented in FORMAT.md ("LaTeX Export").
//
//   node scripts/export-latex.mjs <input.md> [options]
//
// Options:
//   -o, --output <path>      Output .tex path (default: out/<basename>.tex)
//   --template <name|path>   article (default; Springer LNCS), lipics, or a template path
//   --bibliography <value>   Overrides frontmatter bibliography
//   --csl <name|path>        CSL style for citeproc mode
//   --natbib                 Emit \citep + \bibliography instead of citeproc
//   --biblio-style <style>   BibTeX style for --natbib (template default otherwise)
//   --pdf                    Run latexmk -pdf on the result
//
// Frontmatter `bibliography:`/`csl:`/`latex:` config applies; CLI flags win.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preprocessWithReadFile } from "../src/editor/latex/preprocess-core.mjs";
import {
  buildLatexPandocArgs,
  parseLatexFrontmatterConfig,
  resolveLatexCslPath,
  resolveLatexExportOptions,
  resolveLatexTemplatePath,
} from "../src/editor/latex/export-options.mjs";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const latexDir = resolve(repoDir, "src/editor/latex");
const citationDir = resolve(repoDir, "src/editor/citations");

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--natbib" || arg === "--pdf") flags[arg.slice(2)] = true;
    else if (arg === "-o" || arg === "--output") flags.output = argv[++i];
    else if (arg === "--template") flags.template = argv[++i];
    else if (arg === "--bibliography") flags.bibliography = argv[++i];
    else if (arg === "--csl") flags.csl = argv[++i];
    else if (arg === "--biblio-style") flags.biblioStyle = argv[++i];
    else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else flags._.push(arg);
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const input = flags._[0];
if (!input) {
  console.error("usage: export-latex.mjs <input.md> [options]");
  process.exit(2);
}
const inputPath = resolve(input);
const sourceDir = dirname(inputPath);
const outputPath = resolve(flags.output ?? `out/${basename(inputPath).replace(/\.md$/, "")}.tex`);
await mkdir(dirname(outputPath), { recursive: true });

const source = await readFile(inputPath, "utf8");
const config = parseLatexFrontmatterConfig(source);
const options = resolveLatexExportOptions({ config, flags });

// In natbib mode the template writes \bibliography{<name>}, so strip .bib;
// in citeproc mode the metadata value must locate the actual file.
let bibliography = options.bibliography;
if (flags.natbib && bibliography) bibliography = bibliography.replace(/\.bib$/, "");
if (!flags.natbib && bibliography && !bibliography.endsWith(".bib")) bibliography += ".bib";

const tmpMd = `${outputPath}.pre.md`;
await writeFile(tmpMd, await preprocessWithReadFile(source));

let args = buildLatexPandocArgs({
  bibliography,
  cslPath:
    options.csl === "ieee"
      ? resolve(citationDir, "ieee.csl")
      : resolveLatexCslPath(options.csl, { cwd: sourceDir, latexDir }),
  filterPath: `${latexDir}/filter.lua`,
  template: resolveLatexTemplatePath(options.template, { cwd: sourceDir, latexDir }),
  output: outputPath,
  resourcePath: sourceDir,
});
if (flags.natbib) {
  args = args.filter((a) => a !== "--citeproc" && !a.startsWith("--csl="));
  args.push("--natbib");
  if (flags.biblioStyle) args.push(`--metadata=biblio-style=${flags.biblioStyle}`);
}

const pandoc = spawnSync("pandoc", [...args, tmpMd], { stdio: "inherit", cwd: sourceDir });
await rm(tmpMd, { force: true });
if (pandoc.status) process.exit(pandoc.status);
console.log(outputPath);

if (flags.pdf) {
  const latexmk = spawnSync(
    "latexmk",
    ["-pdf", "-interaction=nonstopmode", `-output-directory=${dirname(outputPath)}`, outputPath],
    { stdio: "inherit", cwd: sourceDir },
  );
  process.exit(latexmk.status ?? 0);
}
