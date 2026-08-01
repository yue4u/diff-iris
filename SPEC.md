# diff-iris specification

## Command

`diff-iris` runs inside a trusted Git repository and analyzes the root `package.json` reachable from
the current `HEAD`. It resolves the repository root when invoked from a subdirectory. Uncommitted
working-tree changes, nested manifests, lockfiles, other refs, and network metadata are excluded.

Supported arguments are `--help`, `-h`, `--version`, `-v`, `--since DATE`, and `--until DATE`.
Date options also accept `--since=DATE` and `--until=DATE`; dates use `YYYY-MM-DD` and inclusive UTC
boundaries. Either bound may be omitted. Invalid dates, reversed ranges, unsupported arguments, and
missing Git context produce a nonzero exit status and a concise message on stderr.

When stdout is a terminal, the command writes `.diff-iris/index.html` at the repository root and
prints its path to stderr. When stdout is redirected or piped, it emits only HTML to stdout and does
not create the default report file. Warnings and errors always use stderr.

## History and dependency changes

The history is every non-merge commit reachable from `HEAD`. Each commit's root manifest blob is
compared directly with its sole parent, preserving attribution across branches without constructing a
linear snapshot. Merge commits are excluded, including changes created only during merge conflict
resolution.

The following string-valued maps are analyzed:

- `dependencies`
- `devDependencies`
- `peerDependencies`
- `optionalDependencies`

Requirements are compared as exact strings; versions are not interpreted as semver ranges. Manifest
creation adds every dependency, and manifest deletion removes every dependency. A version change is
an update. An unambiguous move between dependency sections is stored as an update and displayed as a
delete from the source group plus an add to the destination group. Ambiguous duplicate names across
sections remain independent additions and removals.

Malformed historical manifests, and comparisons that depend on them, are skipped with SHA-specific
warnings. Remaining history is still reported.

## Git data collection

The collector uses one NUL-delimited `git log --full-history --raw` invocation for commit metadata and
blob IDs, then one `git cat-file --batch` invocation for unique manifest blobs. It must not spawn one
Git process per commit. Binary process output is handled as `Uint8Array`, not Node.js `Buffer`.

Commit data includes full SHA, canonical `.mailmap` author name and email, canonical committer name,
committer timestamp, subject, and complete multiline commit message. Timestamps are normalized with
the `Temporal` API provided by `temporal-polyfill-lite` and grouped by UTC calendar date.

## HTML report

The report is one offline HTML document with embedded CSS and a compiled Vue Vapor client. The client
is authored as type-checked TypeScript and Vue SFC templates, then bundled to an inline IIFE during
`vp pack`; it makes no external requests. Repository and Git content is untrusted data: it is escaped
during serialization and rendered as template text or text DOM properties, never interpreted through
`innerHTML`.

The report contains:

- repository, ref, revision, report generation time, and diff-iris version metadata;
- the analyzed repository's normalized HTTPS `origin` link when available;
- net totals for visible commits, additions, updates, and removals, including commit counts grouped
  by canonical committer name, package names, and each package's first-to-final version diff;
- native hint popovers on committer totals that list the packages changed by that committer;
- a horizontal density timeline with start and end handles;
- synchronized UTC start and end date inputs;
- a reset-range control;
- newest-first commit cards with author, time, subject, SHA, and expandable full message;
- dependency changes grouped as `deps`, `dev`, `peer`, and `optional`;
- Git-style addition/removal markers, struck-through deletions, and inline old-to-new version updates.

The dependency-change section initially shows up to three commit cards. Additional cards use
`hidden="until-found"` so browser Find can reveal matching commits and packages, and an explicit
control reveals all remaining cards for ordinary browsing.

The default dark theme uses the `#261C2C`, `#3E2C41`, `#5C527F`, and `#6E85B2` palette. A
`prefers-color-scheme: light` theme uses palette-derived light surfaces and darker semantic text
colors to retain readable contrast. Additions and final versions remain semantic green in both color
schemes. Added/final and removed/initial values use filled semantic backgrounds with inverted,
contrast-safe foreground text.

Moving either timeline handle or changing a date filters commit cards and recalculates every summary
total. Package totals collapse all activity in the selected range into a net first-to-final diff;
packages that return to their starting version and section are omitted. Slider positions correspond
to UTC dates that contain changes, so long inactive periods do not consume empty positions.
Slider, date-input, URL, range-summary, and live-region state updates are immediate. Commit and change
counts use prefix totals so the range panel remains synchronous without scanning events. Package
aggregation and commit rendering use a short trailing debounce so pointer interaction is not blocked
by report rendering.
The histogram remains a non-interactive visualization so pointer scrolling over it behaves normally.
The range track has a taller transparent hit target than its visible line; clicking or dragging it
moves the nearest range handle. Native handle dragging and keyboard operation remain available.

Added, removed, and updated package summaries are fully expanded responsive grids rather than
scrolling lists. Updated entries are grouped by the first changed component of the minimum versions
accepted by their SemVer requirements: `major`, `minor`, `patch`, then `other` for requirements that
SemVer cannot interpret, section-only moves, and changes with identical minimum-version components.
Updated entries use wider grid cells for long requirement strings. The report uses up to 1200px of
viewport width and no text style smaller than 14px.

Commit-level update rows keep the package name on the first line and the complete old-to-new version
diff on a second line. Long requirements wrap inside their own value boxes without separating the
arrow from the version pair.

## Shareable time range

The selected range is stored in the current URL using inclusive UTC query parameters:

```text
?from=YYYY-MM-DD&to=YYYY-MM-DD
```

The report loads valid parameters on startup and snaps them to the nearest dates containing changes.
Missing bounds default to the first or last available date. Invalid or reversed ranges fall back to
the complete history. Changes use `history.replaceState`, preserve unrelated query parameters and the
URL hash, and do not add browser-history entries. If an embedded or local-file viewer forbids history
updates, filtering continues without URL persistence.

## Security and compatibility

Only run `diff-iris` inside repositories you trust. The command invokes the local Git executable and
reads committed repository content. The generated report is designed for current browsers supporting
standard range/date inputs, URL APIs, CSS custom properties, and modern JavaScript collections.
