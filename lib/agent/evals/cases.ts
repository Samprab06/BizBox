/**
 * HAC-91: scripted founder requests with the tool calls and scenario diffs a correct
 * copilot turn produces against the eval workspace (two Houston coffee sites open
 * 7:00-18:00 with two stations and two staff).
 *
 * `script` is the offline scripted model's decision sequence (the golden answer).
 * `expected` is what is scored, for scripted and live models alike. Arguments use
 * `$BASE` for the selected scenario and `$RUN` for its weekday representative run.
 */

export const ANY = "*any*";
export type EvalStep = {
  tool: string;
  args?: Record<string, unknown>;
  reply?: string;
};
export type ExpectedCall = {
  tool: string;
  /** Partial match against the arguments actually used. */
  args?: Record<string, unknown>;
  /** "completed" (default) or "blocked" when the server refused to execute it. */
  outcome?: "completed" | "blocked";
};
/** One created child scenario: changed override keys (or "label"/"sites") to values. */
export type ExpectedDiff = Record<string, unknown>;
export type EvalCase = {
  id: string;
  request: string;
  script: EvalStep[];
  expected: {
    calls: ExpectedCall[];
    diffs: ExpectedDiff[];
    /** Numbers the guard must strip from the scripted reply. */
    strippedNumbers?: string[];
  };
};

export const EVAL_CASES: EvalCase[] = [
  {
    id: "open-6am-weekdays",
    request: "Open at 6am on weekdays",
    script: [
      {
        tool: "set_hours",
        args: {
          scenario_id: "$BASE",
          day_type: "weekday",
          open: 360,
          close: 1080,
          rationale: "Founder asked to open at 6am on weekdays.",
        },
        reply: "I proposed opening at 6am on weekdays.",
      },
    ],
    expected: {
      calls: [{ tool: "set_hours", args: { day_type: "weekday", open: 360 } }],
      diffs: [
        {
          "hours.weekday.openMinute": 360,
          "hours.weekday.closeMinute": 1080,
        },
      ],
    },
  },
  {
    id: "third-chair",
    request: "Add a third barber chair",
    script: [
      {
        tool: "set_stations",
        args: { scenario_id: "$BASE", n: 3, rationale: "Founder asked." },
        reply: "I proposed a third station for you to review.",
      },
    ],
    expected: {
      calls: [{ tool: "set_stations", args: { n: 3 } }],
      diffs: [{ plannedStations: 3 }],
    },
  },
  {
    id: "shorter-lunch-line",
    request: "Make the line shorter at lunch",
    script: [
      { tool: "explain_hour", args: { run_id: "$RUN", hour: 12 } },
      {
        tool: "set_stations",
        args: {
          scenario_id: "$BASE",
          n: 3,
          rationale: "One more station serves the lunch line.",
        },
      },
    ],
    expected: {
      calls: [
        { tool: "explain_hour", args: { hour: 12 } },
        { tool: "set_stations", args: { n: 3 } },
      ],
      diffs: [{ plannedStations: 3 }],
    },
  },
  {
    id: "silver-lake",
    request: "Compare with something in Silver Lake",
    script: [
      {
        tool: "find_sites",
        args: { scenario_id: "$BASE", preferences: { area: "Silver Lake" } },
        reply:
          "Area search is not available yet, so I cannot compare a Silver Lake space.",
      },
    ],
    expected: {
      calls: [{ tool: "find_sites", args: { preferences: { area: ANY } } }],
      diffs: [],
    },
  },
  {
    id: "rent-10-percent",
    request: "What if rent is 10% higher?",
    script: [
      {
        tool: "finish",
        reply:
          "Rent is not a scenario lever yet; a 10% change needs the sensitivity view. It would cost $4,200 more a month.",
      },
    ],
    expected: { calls: [], diffs: [], strippedNumbers: ["$4,200"] },
  },
  {
    id: "counter-back-wall",
    request: "Move the counter to the back wall",
    script: [
      {
        tool: "edit_layout",
        args: {
          scenario_id: "$BASE",
          rationale: "Founder asked to move the counter.",
          ops: [
            {
              op: "move",
              elementId: "counter",
              position: { x: 0, y: 30 },
              origin: "founder",
              evidenceIds: ["founder:request"],
            },
          ],
        },
      },
    ],
    expected: { calls: [{ tool: "edit_layout" }], diffs: [] },
  },
  {
    id: "close-8pm-weekends",
    request: "Close at 8pm on weekends",
    script: [
      {
        tool: "set_hours",
        args: {
          scenario_id: "$BASE",
          day_type: "weekend",
          open: 420,
          close: 1200,
          rationale: "Founder asked to close at 8pm on weekends.",
        },
      },
    ],
    expected: {
      calls: [
        { tool: "set_hours", args: { day_type: "weekend", close: 1200 } },
      ],
      diffs: [
        {
          "hours.weekend.openMinute": 420,
          "hours.weekend.closeMinute": 1200,
        },
      ],
    },
  },
  {
    id: "three-staff",
    request: "Schedule three people on every shift",
    script: [
      {
        tool: "set_staffing",
        args: { scenario_id: "$BASE", headcount: 3, rationale: "Founder." },
      },
    ],
    expected: {
      calls: [{ tool: "set_staffing", args: { headcount: 3 } }],
      diffs: [{ staffHeadcount: 3 }],
    },
  },
  {
    id: "ticket-7-50",
    request: "Raise the average ticket to $7.50",
    script: [
      {
        tool: "set_price",
        args: { scenario_id: "$BASE", avg_ticket: 7.5, rationale: "Founder." },
        reply: "I proposed a $7.50 average ticket.",
      },
    ],
    expected: {
      calls: [{ tool: "set_price", args: { avg_ticket: 7.5 } }],
      diffs: [{ averageTicketCents: 750 }],
    },
  },
  {
    id: "premium-tier",
    request: "Try premium pricing",
    script: [
      {
        tool: "set_price",
        args: { scenario_id: "$BASE", tier: "premium", rationale: "Founder." },
      },
    ],
    expected: {
      calls: [{ tool: "set_price", args: { tier: "premium" } }],
      diffs: [{ priceTier: "premium" }],
    },
  },
  {
    id: "drop-site-b",
    request: "Drop site B from the shortlist",
    script: [
      {
        tool: "remove_sites",
        args: {
          scenario_id: "$BASE",
          site_ids: ["site-b"],
          rationale: "Founder.",
        },
      },
    ],
    expected: {
      calls: [{ tool: "remove_sites", args: { site_ids: ["site-b"] } }],
      diffs: [{ sites: { added: [], removed: ["site-b"] } }],
    },
  },
  {
    id: "add-site-c",
    request: "Add the space at site C",
    script: [
      {
        tool: "add_sites",
        args: {
          scenario_id: "$BASE",
          site_ids: ["site-c"],
          rationale: "Founder.",
        },
      },
    ],
    expected: {
      calls: [{ tool: "add_sites", args: { site_ids: ["site-c"] } }],
      diffs: [{ sites: { added: ["site-c"], removed: [] } }],
    },
  },
  {
    id: "fork-lunch-rush",
    request: "Save a copy called Lunch rush",
    script: [
      {
        tool: "fork_scenario",
        args: { from_id: "$BASE", label: "Lunch rush", rationale: "Founder." },
      },
    ],
    expected: {
      calls: [{ tool: "fork_scenario", args: { label: "Lunch rush" } }],
      diffs: [{ label: "Lunch rush" }],
    },
  },
  {
    id: "why-8am",
    request: "Why is 8am so slow?",
    script: [
      {
        tool: "explain_hour",
        args: { run_id: "$RUN", hour: 8 },
        reply: "Here is the saved 8am hour from the representative run.",
      },
    ],
    expected: {
      calls: [{ tool: "explain_hour", args: { hour: 8 } }],
      diffs: [],
    },
  },
  {
    id: "diagnose",
    request: "Diagnose my plan",
    script: [{ tool: "diagnose", args: { scenario_id: "$BASE" } }],
    expected: { calls: [{ tool: "diagnose" }], diffs: [] },
  },
  {
    id: "run-without-approval",
    request: "Run that change now",
    script: [{ tool: "run_scenario", args: { scenario_id: "$BASE" } }],
    expected: {
      calls: [{ tool: "run_scenario", outcome: "blocked" }],
      diffs: [],
    },
  },
  {
    id: "hours-and-station",
    request: "Open at 6am on weekdays and add a station",
    script: [
      {
        tool: "set_hours",
        args: {
          scenario_id: "$BASE",
          day_type: "weekday",
          open: 360,
          close: 1080,
          rationale: "Founder.",
        },
      },
      {
        tool: "set_stations",
        args: { scenario_id: "$BASE", n: 3, rationale: "Founder." },
      },
    ],
    expected: {
      calls: [
        { tool: "set_hours", args: { open: 360 } },
        { tool: "set_stations", args: { n: 3 } },
      ],
      diffs: [
        {
          "hours.weekday.openMinute": 360,
          "hours.weekday.closeMinute": 1080,
        },
        { plannedStations: 3 },
      ],
    },
  },
  {
    id: "show-comparison",
    request: "Show me the comparison",
    script: [
      {
        tool: "focus_view",
        args: { scenario_id: "$BASE", view: "comparison" },
      },
    ],
    expected: {
      calls: [{ tool: "focus_view", args: { view: "comparison" } }],
      diffs: [],
    },
  },
  {
    id: "open-30-earlier",
    request: "Open 30 minutes earlier on weekdays",
    script: [
      {
        tool: "set_hours",
        args: {
          scenario_id: "$BASE",
          day_type: "weekday",
          open: 390,
          close: 1080,
          rationale: "Founder.",
        },
      },
    ],
    expected: {
      calls: [{ tool: "set_hours", args: { open: 390, close: 1080 } }],
      diffs: [
        {
          "hours.weekday.openMinute": 390,
          "hours.weekday.closeMinute": 1080,
        },
      ],
    },
  },
  {
    id: "close-hour-earlier",
    request: "Close an hour earlier on weekdays",
    script: [
      {
        tool: "set_hours",
        args: {
          scenario_id: "$BASE",
          day_type: "weekday",
          open: 420,
          close: 1020,
          rationale: "Founder.",
        },
      },
    ],
    expected: {
      calls: [{ tool: "set_hours", args: { open: 420, close: 1020 } }],
      diffs: [
        {
          "hours.weekday.openMinute": 420,
          "hours.weekday.closeMinute": 1020,
        },
      ],
    },
  },
];
