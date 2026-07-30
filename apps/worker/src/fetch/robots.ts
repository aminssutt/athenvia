export type RobotsRules = {
  allowed(pathAndQuery: string): boolean;
  crawlDelayMs: number | null;
};

type RobotsGroup = {
  agents: string[];
  crawlDelaySeconds: number | null;
  rules: Array<{ allow: boolean; path: string }>;
};

function parseGroups(content: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawDirective = false;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    const separator = line.indexOf(":");
    if (!line || separator < 0) {
      continue;
    }

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || sawDirective) {
        current = { agents: [], crawlDelaySeconds: null, rules: [] };
        groups.push(current);
        sawDirective = false;
      }
      if (value) {
        current.agents.push(value.toLowerCase());
      }
      continue;
    }

    if (!current || current.agents.length === 0) {
      continue;
    }

    if (field === "allow" || field === "disallow") {
      sawDirective = true;
      if (value || field === "allow") {
        current.rules.push({ allow: field === "allow", path: value });
      }
    } else if (field === "crawl-delay") {
      sawDirective = true;
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) {
        current.crawlDelaySeconds = delay;
      }
    }
  }

  return groups;
}

export function parseRobots(content: string, userAgent = "athenviabot"): RobotsRules {
  const groups = parseGroups(content);
  const exactGroups = groups.filter(({ agents }) =>
    agents.some((agent) => userAgent.toLowerCase().startsWith(agent) && agent !== "*"),
  );
  const selected =
    exactGroups.length > 0
      ? exactGroups
      : groups.filter(({ agents }) => agents.some((agent) => agent === "*"));
  const rules = selected.flatMap((group) => group.rules);
  const crawlDelaySeconds = selected
    .map(({ crawlDelaySeconds: delay }) => delay)
    .filter((delay): delay is number => delay !== null)
    .reduce<number | null>((maximum, delay) => Math.max(maximum ?? 0, delay), null);

  return {
    allowed(pathAndQuery) {
      const matches = rules
        .filter(({ path }) => robotsPathMatches(pathAndQuery, path))
        .sort((left, right) => {
          const lengthDifference = ruleSpecificity(right.path) - ruleSpecificity(left.path);
          return lengthDifference || Number(right.allow) - Number(left.allow);
        });
      return matches[0]?.allow ?? true;
    },
    crawlDelayMs:
      crawlDelaySeconds === null ? null : Math.min(Math.ceil(crawlDelaySeconds * 1_000), 60_000),
  };
}

function ruleSpecificity(rule: string): number {
  return rule.replaceAll("*", "").replace(/\$$/u, "").length;
}

function robotsPathMatches(pathAndQuery: string, rule: string): boolean {
  if (!rule) {
    return false;
  }

  const anchoredAtEnd = rule.endsWith("$");
  const pattern = anchoredAtEnd ? rule.slice(0, -1) : rule;
  const escaped = pattern
    .split("*")
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${anchoredAtEnd ? "$" : ""}`, "u").test(pathAndQuery);
}
