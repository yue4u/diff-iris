# diff-iris

Parse and show structured data in git history.

Repository: <https://github.com/yue4u/diff-iris>

## How to use

```bash
pnpm dlx diff-iris
# Analyze the root package.json reachable from HEAD and create .diff-iris/index.html.

pnpm dlx diff-iris > index.html
# When stdout is redirected or piped, emit the HTML document instead of writing a file.

pnpm dlx diff-iris --since 2024-01-01 --until 2024-12-31
# Include only changes within an inclusive UTC date range.

pnpm dlx diff-iris ownership 'Alice|Bob'
# Count HEAD files with surviving lines authored by Alice or Bob.

pnpm dlx diff-iris ownership --author Alice --author Bob --jobs 16
# Repeat author patterns and control the bounded parallel blame workers.

pnpm dlx diff-iris ownership --rank
# Count every author once, then rank by attributed files and lines.

pnpm dlx diff-iris ownership --rank --format json
pnpm dlx diff-iris ownership --rank --format html > ownership.html
# Emit structured JSON or a standalone HTML ranking report.
```

> [!WARNING]
> Only run `diff-iris` inside repositories you trust. It invokes the repository's local Git
> installation and reads committed repository content and metadata. The default command generates
> an executable HTML report.

## Features

- fast git history parse time
- single html output
- timeline of when, who, and what changed in dependency fields of `package.json`
- additions, removals, version updates, and dependency-section moves
- full commit metadata and commit messages
- synchronized timeline slider and UTC date pickers for selecting a time range
- shareable `?from=YYYY-MM-DD&to=YYYY-MM-DD` time-range URLs
- offline report with no external scripts, styles, fonts, or network requests
- fast, regex-aware file ownership counts based on surviving blamed lines
- automatic Git commit-graph maintenance for faster ownership analysis in large repositories

## Spec

- See [SPEC.md](./SPEC.md) for the complete behavior contract.
- analyzes `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`
- walks all non-merge commits reachable from the current `HEAD`
- compares version requirements as exact strings
- uses the JS `Temporal` API through `temporal-polyfill-lite`
- uses `Uint8Array` rather than Node.js `Buffer` for Git's binary output

The working tree is not included. Run the command again after committing changes to regenerate the
report. Invalid historical manifests and comparisons that depend on them are skipped with a warning
that names the affected commit.

## Future

support more file/history types

## Development

- Install dependencies:

```bash
vp install
```

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```
