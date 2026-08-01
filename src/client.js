const report = JSON.parse(document.querySelector("#report-data").textContent);
const dates = [...new Set(report.events.map((event) => event.commit.utcDate))];
const dateIndex = new Map(dates.map((date, index) => [date, index]));
const commitsByDate = Array.from({ length: dates.length }, () => 0);
const changesByDate = Array.from({ length: dates.length }, () => 0);
for (const event of report.events) {
  const index = dateIndex.get(event.commit.utcDate);
  commitsByDate[index]++;
  changesByDate[index] += event.changes.length;
}
const commitPrefix = [0];
const changePrefix = [0];
for (let index = 0; index < dates.length; index++) {
  commitPrefix.push(commitPrefix[index] + commitsByDate[index]);
  changePrefix.push(changePrefix[index] + changesByDate[index]);
}
const startSlider = document.querySelector("#start-slider");
const endSlider = document.querySelector("#end-slider");
const startDate = document.querySelector("#start-date");
const endDate = document.querySelector("#end-date");
const eventList = document.querySelector("#events");
const emptyState = document.querySelector("#empty-state");
const rangeSummary = document.querySelector("#range-summary");
const liveRange = document.querySelector("#live-range");
const timelineBars = document.querySelector("#timeline-bars");
const sliderTrack = document.querySelector("#slider-track");
const totalElements = {
  commits: document.querySelector("#total-commits"),
  added: document.querySelector("#total-added"),
  updated: document.querySelector("#total-updated"),
  removed: document.querySelector("#total-removed"),
};
const totalPackageElements = {
  added: document.querySelector("#total-added-packages"),
  updated: document.querySelector("#total-updated-packages"),
  removed: document.querySelector("#total-removed-packages"),
};
const totalCommitters = document.querySelector("#total-committers");
const committerPopovers = document.querySelector("#committer-popovers");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function lowerBound(value) {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (dates[middle] < value) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, dates.length - 1);
}

function upperBound(value) {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (dates[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function rangeFromUrl(last) {
  const parameters = new URLSearchParams(window.location.search);
  const from = parameters.get("from");
  const to = parameters.get("to");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const start = from && datePattern.test(from) ? lowerBound(from) : 0;
  const end = to && datePattern.test(to) ? upperBound(to) : last;
  return start <= end ? [start, end] : [0, last];
}

function saveRangeToUrl(from, to) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    window.history.replaceState(null, "", url);
  } catch {
    // Some embedded viewers do not allow file URL history updates.
  }
}

const sectionOrder = [
  ["dependencies", "deps"],
  ["devDependencies", "dev"],
  ["peerDependencies", "peer"],
  ["optionalDependencies", "optional"],
];

function renderChange(change) {
  const row = element("li", `change change-${change.type}`);
  const operation = { added: "+", updated: "~", removed: "-" }[change.type];
  row.append(element("span", "change-kind", operation), element("strong", "package", change.name));
  if (change.type === "added") {
    row.append(element("span", "change-value", change.current.version));
  } else if (change.type === "removed") {
    row.append(element("span", "change-value", change.previous.version));
  } else {
    const versionDiff = element("span", "version-diff");
    versionDiff.append(
      element("span", "change-value previous-value", change.previous.version),
      element("span", "arrow", "→"),
      element("span", "change-value current-value", change.current.version),
    );
    row.append(versionDiff);
  }
  return row;
}

function changesBySection(changes) {
  const groups = new Map(sectionOrder.map(([section]) => [section, []]));
  for (const change of changes) {
    if (change.type === "updated" && change.previous.section !== change.current.section) {
      groups.get(change.previous.section).push({
        type: "removed",
        name: change.name,
        previous: change.previous,
      });
      groups.get(change.current.section).push({
        type: "added",
        name: change.name,
        current: change.current,
      });
      continue;
    }
    const section = change.current?.section ?? change.previous.section;
    groups.get(section).push(change);
  }
  return groups;
}

function sameLocation(left, right) {
  return left?.section === right?.section && left?.version === right?.version;
}

function summarizePackages(events) {
  const packages = new Map();
  for (const event of events.toReversed()) {
    for (const change of event.changes) {
      const existing = packages.get(change.name);
      if (!existing) {
        packages.set(change.name, {
          name: change.name,
          initial: change.previous,
          final: change.current,
        });
      } else {
        existing.final = change.current;
      }
    }
  }

  const summary = { added: [], updated: [], removed: [] };
  for (const entry of packages.values()) {
    if (sameLocation(entry.initial, entry.final)) continue;
    if (!entry.initial && entry.final) summary.added.push(entry);
    else if (entry.initial && !entry.final) summary.removed.push(entry);
    else summary.updated.push(entry);
  }
  for (const entries of Object.values(summary)) {
    entries.sort((left, right) => left.name.localeCompare(right.name));
  }
  return summary;
}

function summaryLocation(location, includeSection = false) {
  if (!location) return "";
  const section = sectionOrder.find(([name]) => name === location.section)?.[1];
  return includeSection ? `${location.version} · ${section}` : location.version;
}

function updateKind(entry) {
  const initial = report.semver[entry.initial.version];
  const final = report.semver[entry.final.version];
  if (!initial || !final) return "other";
  if (initial[0] !== final[0]) return "major";
  if (initial[1] !== final[1]) return "minor";
  if (initial[2] !== final[2]) return "patch";
  return "other";
}

function renderPackageSummaryEntry(kind, entry) {
  const item = element("li", "total-package");
  item.append(element("strong", "", entry.name));
  if (kind === "added") {
    item.append(element("span", "total-final", summaryLocation(entry.final)));
  } else if (kind === "removed") {
    item.append(element("span", "total-initial", summaryLocation(entry.initial)));
  } else {
    const moved = entry.initial.section !== entry.final.section;
    item.append(
      element("span", "total-initial", summaryLocation(entry.initial, moved)),
      element("span", "arrow", "→"),
      element("span", "total-final", summaryLocation(entry.final, moved)),
    );
  }
  return item;
}

function renderPackageSummary(kind, entries) {
  const list = totalPackageElements[kind];
  let items;
  if (kind === "updated") {
    const groupLabels = {
      major: ["Major", "breaking changes"],
      minor: ["Minor", "new features"],
      patch: ["Patch", "fixes"],
      other: ["Other", "uncategorized"],
    };
    const groups = Map.groupBy(entries, updateKind);
    items = ["major", "minor", "patch", "other"].flatMap((name) => {
      const groupEntries = groups.get(name);
      if (!groupEntries) return [];
      const group = element("li", `total-package-group total-package-group-${name}`);
      const title = element("h3", "total-package-group-title");
      title.append(
        element("span", "total-package-group-name", groupLabels[name][0]),
        element("span", "total-package-group-description", groupLabels[name][1]),
        element(
          "span",
          "total-package-group-count",
          `${groupEntries.length} ${groupEntries.length === 1 ? "package" : "packages"}`,
        ),
      );
      group.append(title);
      const groupList = element("ul", "total-package-group-list");
      groupList.append(...groupEntries.map((entry) => renderPackageSummaryEntry(kind, entry)));
      group.append(groupList);
      return [group];
    });
  } else {
    items = entries.map((entry) => renderPackageSummaryEntry(kind, entry));
  }
  list.replaceChildren(...items);
  list.hidden = items.length === 0;
}

function renderCommitters(events) {
  const groups = Map.groupBy(events, (event) => event.commit.committerName);
  const committers = [...groups]
    .map(([name, commits]) => ({
      name,
      count: commits.length,
      packages: [
        ...new Set(commits.flatMap((event) => event.changes.map((change) => change.name))),
      ].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  const popovers = [];
  const items = committers.map(({ name, count, packages }, index) => {
    const item = element("li", "total-committer");
    const trigger = element("button", "total-committer-trigger");
    const popoverId = `committer-popover-${index}`;
    trigger.type = "button";
    trigger.setAttribute("popovertarget", popoverId);
    trigger.setAttribute("aria-label", `${name}: ${count} commits; show changed packages`);
    trigger.append(
      element("span", "total-committer-name", name),
      element("strong", "total-committer-count", String(count)),
    );
    item.append(trigger);

    const popover = element("div", "committer-popover");
    popover.id = popoverId;
    popover.setAttribute("popover", "hint");
    popover.append(element("strong", "committer-popover-title", name));
    popover.append(
      element(
        "span",
        "committer-popover-summary",
        `${packages.length} changed ${packages.length === 1 ? "package" : "packages"}`,
      ),
    );
    const packageList = element("ul", "committer-popover-packages");
    packageList.append(...packages.map((name) => element("li", "", name)));
    popover.append(packageList);
    popovers.push(popover);

    let hideTimer;
    const show = () => {
      clearTimeout(hideTimer);
      if (!popover.matches(":popover-open")) popover.showPopover();
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - popoverRect.width - 8,
        Math.max(8, triggerRect.left),
      );
      const below = triggerRect.bottom + 6;
      const top =
        below + popoverRect.height <= window.innerHeight
          ? below
          : Math.max(8, triggerRect.top - popoverRect.height - 6);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };
    const hide = () => {
      hideTimer = setTimeout(() => {
        if (popover.matches(":popover-open")) popover.hidePopover();
      }, 100);
    };
    trigger.addEventListener("pointerenter", show);
    trigger.addEventListener("pointerleave", hide);
    trigger.addEventListener("focus", show);
    trigger.addEventListener("blur", hide);
    popover.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    popover.addEventListener("pointerleave", hide);
    return item;
  });
  committerPopovers.replaceChildren(...popovers);
  totalCommitters.replaceChildren(...items);
  totalCommitters.hidden = items.length === 0;
}

function renderEvent(event) {
  const article = element("article", "commit");
  const header = element("header", "commit-header");
  const heading = element("h3", "commit-subject", event.commit.subject || "(no subject)");
  heading.prepend(element("code", "sha", event.commit.sha.slice(0, 12)));
  header.append(heading);

  const metadata = element("p", "metadata");
  metadata.append(
    element("span", "timestamp", event.commit.committedAt),
    element("span", "author", `${event.commit.authorName} <${event.commit.authorEmail}>`),
  );
  header.append(metadata);
  article.append(header);

  const groups = changesBySection(event.changes);
  for (const [section, label] of sectionOrder) {
    const sectionChanges = groups.get(section);
    if (sectionChanges.length === 0) continue;
    const group = element("section", "change-group");
    group.append(element("h4", "change-group-title", label));
    const list = element("ul", "changes");
    sectionChanges.forEach((change) => list.append(renderChange(change)));
    group.append(list);
    article.append(group);
  }

  const details = element("details", "message");
  details.append(element("summary", "", "Full commit message"));
  details.append(element("pre", "message-body", event.commit.message || "(empty message)"));
  article.append(details);
  return article;
}

function renderEvents(events) {
  const hiddenCommits = [];
  const articles = events.map((event, index) => {
    const article = renderEvent(event);
    if (index >= 3) {
      article.setAttribute("hidden", "until-found");
      article.addEventListener("beforematch", revealHiddenCommits);
      hiddenCommits.push(article);
    }
    return article;
  });

  let revealButton;
  function revealHiddenCommits() {
    hiddenCommits.forEach((article) => article.removeAttribute("hidden"));
    revealButton?.remove();
  }
  if (hiddenCommits.length > 0) {
    revealButton = element("button", "reveal-commits", `Show ${hiddenCommits.length} more commits`);
    revealButton.type = "button";
    revealButton.addEventListener("click", revealHiddenCommits);
    articles.push(revealButton);
  }
  eventList.replaceChildren(...articles);
}

function renderTimeline() {
  const binCount = Math.min(96, Math.max(1, dates.length));
  const bins = Array.from({ length: binCount }, () => 0);
  for (const event of report.events) {
    const index = dateIndex.get(event.commit.utcDate);
    const bin = Math.min(binCount - 1, Math.floor((index * binCount) / dates.length));
    bins[bin] += event.changes.length;
  }
  const maximum = Math.max(...bins, 1);
  bins.forEach((count) => {
    const bar = element("span", "timeline-bar");
    bar.style.height = `${Math.max(2, Math.round((count / maximum) * 54))}px`;
    timelineBars.append(bar);
  });
}

let rangeRenderTimer;

function renderSelectedRange(start, end) {
  const scrollTop = document.scrollingElement?.scrollTop;
  const visible = report.events
    .filter((event) => event.commit.utcDate >= dates[start] && event.commit.utcDate <= dates[end])
    .toReversed();
  const packageSummary = summarizePackages(visible);
  const totals = {
    commits: visible.length,
    added: packageSummary.added.length,
    updated: packageSummary.updated.length,
    removed: packageSummary.removed.length,
  };
  for (const [name, value] of Object.entries(totals)) {
    totalElements[name].textContent = String(value);
  }
  for (const kind of ["added", "updated", "removed"]) {
    renderPackageSummary(kind, packageSummary[kind]);
  }
  renderCommitters(visible);
  renderEvents(visible);
  emptyState.hidden = visible.length !== 0;
  if (scrollTop !== undefined) document.scrollingElement.scrollTop = scrollTop;
}

function update(renderImmediately = false) {
  let start = Number(startSlider.value);
  let end = Number(endSlider.value);
  if (start > end) {
    if (document.activeElement === startSlider) end = start;
    else start = end;
  }
  startSlider.value = String(start);
  endSlider.value = String(end);
  startDate.value = dates[start];
  endDate.value = dates[end];
  saveRangeToUrl(dates[start], dates[end]);

  const denominator = Math.max(1, dates.length - 1);
  sliderTrack.style.setProperty("--start", `${(start / denominator) * 100}%`);
  sliderTrack.style.setProperty("--end", `${(end / denominator) * 100}%`);
  const commitCount = commitPrefix[end + 1] - commitPrefix[start];
  const changeCount = changePrefix[end + 1] - changePrefix[start];
  const summary = `${dates[start]} – ${dates[end]} · ${commitCount} commits · ${changeCount} changes`;
  rangeSummary.textContent = summary;
  liveRange.textContent = `Selected ${summary}`;

  clearTimeout(rangeRenderTimer);
  if (renderImmediately) renderSelectedRange(start, end);
  else rangeRenderTimer = setTimeout(() => renderSelectedRange(start, end), 120);
}

if (dates.length) {
  const last = dates.length - 1;
  for (const input of [startSlider, endSlider]) {
    input.min = "0";
    input.max = String(last);
    input.step = "1";
    input.addEventListener("input", () => update());
  }
  let draggedInput;
  function moveInputToPointer(event, input) {
    const bounds = sliderTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const index = Math.round(ratio * last);
    input.value = String(index);
    input.focus({ preventScroll: true });
    update();
  }
  sliderTrack.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const bounds = sliderTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const index = Math.round(ratio * last);
    const startDistance = Math.abs(index - Number(startSlider.value));
    const endDistance = Math.abs(index - Number(endSlider.value));
    draggedInput = startDistance <= endDistance ? startSlider : endSlider;
    sliderTrack.setPointerCapture(event.pointerId);
    moveInputToPointer(event, draggedInput);
    event.preventDefault();
  });
  sliderTrack.addEventListener("pointermove", (event) => {
    if (draggedInput) moveInputToPointer(event, draggedInput);
  });
  sliderTrack.addEventListener("pointerup", (event) => {
    if (sliderTrack.hasPointerCapture(event.pointerId)) {
      sliderTrack.releasePointerCapture(event.pointerId);
    }
    draggedInput = undefined;
  });
  sliderTrack.addEventListener("pointercancel", () => {
    draggedInput = undefined;
  });
  const [initialStart, initialEnd] = rangeFromUrl(last);
  startSlider.value = String(initialStart);
  endSlider.value = String(initialEnd);
  startDate.min = dates[0];
  startDate.max = dates[last];
  endDate.min = dates[0];
  endDate.max = dates[last];
  startDate.addEventListener("change", () => {
    startSlider.value = String(lowerBound(startDate.value));
    update();
  });
  endDate.addEventListener("change", () => {
    endSlider.value = String(upperBound(endDate.value));
    update();
  });
  document.querySelector("#reset-range").addEventListener("click", () => {
    startSlider.value = "0";
    endSlider.value = String(last);
    update();
  });
  renderTimeline();
  update(true);
} else {
  document.querySelector("#range-controls").hidden = true;
  emptyState.hidden = false;
  emptyState.textContent = "No dependency changes were found in package.json history.";
}
