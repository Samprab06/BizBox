"use client";
import { useState } from "react";
import { SimulatorDemo } from "./demo";
import { demoPlan, type DemoData } from "./fixture";
export function CafeCounterCase({ data }: { data: DemoData }) {
  const [stage, setStage] = useState<"exterior" | "interior" | "report">(
    "exterior",
  );
  const [chosen, setChosen] = useState<0 | 1>(1);
  const money = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  return (
    <main className="mx-auto max-w-[1500px] space-y-6 px-6 py-8">
      <header>
        <p className="text-xs uppercase tracking-wider">
          BizBox · Defined café example
        </p>
        <h1 className="text-3xl font-semibold">
          Is a second staffed counter worth it?
        </h1>
        <p>
          Example assumptions and simulated customers. No database or paid API
          call required.
        </p>
      </header>
      <nav aria-label="Example stages" className="flex gap-4 text-sm">
        <span aria-current={stage === "exterior" ? "step" : undefined}>
          1. Exterior assumptions
        </span>
        <span aria-current={stage === "interior" ? "step" : undefined}>
          2. Interior comparison
        </span>
        <span aria-current={stage === "report" ? "step" : undefined}>
          3. Final report
        </span>
      </nav>
      {stage === "exterior" && (
        <section className="space-y-4 rounded-xl border border-current/20 p-6">
          <h2 className="text-xl font-semibold">
            Hold the location and demand fixed
          </h2>
          <p>
            This is the existing Houston café reference case, not a researched
            listing. It assumes {demoPlan.area.toLocaleString()} sq ft,{" "}
            {money((demoPlan.area * demoPlan.rentPerSquareFoot) / 12)} monthly
            rent, an {money(demoPlan.ticket)} average ticket and{" "}
            {money(demoPlan.wage)}/hour wages.
          </p>
          <p>
            Both plans receive the same 110 generated customers from 8 AM to
            noon. The alternative adds a second staffed counter and{" "}
            {money(demoPlan.alternativeBuildout - demoPlan.baselineBuildout)} in
            buildout. Queue length changes the probability of joining; the
            fixture uses authored behavior, not live Jev.
          </p>
          <button
            className="rounded bg-accent px-4 py-2 text-on-accent"
            onClick={() => setStage("interior")}
          >
            Compare one vs two counters
          </button>
        </section>
      )}
      {stage === "interior" && (
        <>
          <SimulatorDemo
            projectId="counter-example"
            data={data}
            plan={demoPlan}
            context={{
              kind: "simulator",
              phase: "example",
              siteId: "demo-cafe",
              synthetic: true,
            }}
          />
          <section className="space-y-3 rounded-xl border border-current/20 p-4">
            <h2 className="text-lg font-semibold">
              Choose the operating plan for your report
            </h2>
            <label>
              Operating plan{" "}
              <select
                aria-label="Report operating plan"
                value={chosen}
                onChange={(e) => setChosen(Number(e.target.value) as 0 | 1)}
                className="rounded border p-2"
              >
                <option value={0}>One staffed counter</option>
                <option value={1}>Two staffed counters</option>
              </select>
            </label>
            <div className="flex gap-3">
              <button onClick={() => setStage("exterior")}>
                Back to assumptions
              </button>
              <button
                className="rounded bg-accent px-4 py-2 text-on-accent"
                onClick={() => setStage("report")}
              >
                Show final café report
              </button>
            </div>
          </section>
        </>
      )}
      {stage === "report" && (
        <section
          aria-label="Final café report"
          className="space-y-4 rounded-xl border border-current/20 p-6"
        >
          <h2 className="text-xl font-semibold">
            Exterior and interior findings
          </h2>
          <p>
            Chosen plan:{" "}
            {chosen === 0 ? "one staffed counter" : "two staffed counters"}.
            Same location assumptions, demand workload and seed 45.
          </p>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Modeled outcome</th>
                <th>One counter</th>
                <th>Two counters</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  "served",
                  "abandoned",
                  "waitingAtClose",
                  "inServiceAtClose",
                  "meanWaitMin",
                ] as const
              ).map((key) => (
                <tr key={key}>
                  <th className="font-normal">
                    {
                      {
                        served: "Served by noon",
                        abandoned: "Left without service",
                        waitingAtClose: "Still waiting at noon",
                        inServiceAtClose: "Still in service at noon",
                        meanWaitMin: "Completed-customer mean wait (min)",
                      }[key]
                    }
                  </th>
                  {data.map((d, i) => (
                    <td key={i}>
                      {d.run.metrics[key] === null
                        ? "Unavailable"
                        : d.run.metrics[key]!.toLocaleString("en-US", {
                            maximumFractionDigits: 1,
                          })}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th>Monthly revenue</th>
                {data.map((d, i) => (
                  <td key={i}>{money(d.monthly.revenueUsd)}</td>
                ))}
              </tr>
              <tr>
                <th>Monthly contribution</th>
                {data.map((d, i) => (
                  <td key={i}>{money(d.monthly.contributionUsd)}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <p>
            Modeled contribution change:{" "}
            {money(
              data[1].monthly.contributionUsd - data[0].monthly.contributionUsd,
            )}{" "}
            per month. This includes ingredients, labor, rent and buildout
            amortization, repeating this four-hour weekday 22 times. It excludes
            taxes and other overhead.
          </p>
          <p>
            One deterministic example, not an uncertainty estimate or sales
            forecast. Interior travel is illustrative and does not model
            collisions. No real-property scan or observed customer behavior is
            claimed.
          </p>
          <div className="flex gap-4 print:hidden">
            <button onClick={() => setStage("interior")}>
              Return to interior comparison
            </button>
            <button
              className="rounded bg-accent px-4 py-2 text-on-accent"
              onClick={() => window.print()}
            >
              Print or save report
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
