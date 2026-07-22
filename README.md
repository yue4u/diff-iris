# diff-prism

Parse and show structured data in git history.

Repository: <https://github.com/yue4u/diff-prism>

## How to use

```bash
pnpm dlx diff-prism
# Analyze the root package.json reachable from HEAD and create .diff-prism/index.html.

pnpm dlx diff-prism > index.html
# When stdout is redirected or piped, emit the HTML document instead of writing a file.

pnpm dlx diff-prism --since 2024-01-01 --until 2024-12-31
# Include only changes within an inclusive UTC date range.
```

> [!WARNING]
> Only run `diff-prism` inside repositories you trust. It invokes the repository's local Git
> installation and reads committed manifest and commit metadata to generate an executable HTML
> report.

## Features

- fast git history parse time
- single html output
- timeline of when, who, and what changed in dependency fields of `package.json`
- additions, removals, version updates, and dependency-section moves
- full commit metadata and commit messages
- synchronized timeline slider and UTC date pickers for selecting a time range
- shareable `?from=YYYY-MM-DD&to=YYYY-MM-DD` time-range URLs
- offline report with no external scripts, styles, fonts, or network requests

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
