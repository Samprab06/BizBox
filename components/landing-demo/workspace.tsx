"use client";
import Image from "next/image";
import { useState } from "react";
import type { LandingDemoData } from "./demo-data";
import type { chapterAt, ExperimentChoice } from "./timeline";
import { Glass, Icon, WordHeading, dollars, number } from "./demo-ui";
import { CustomerFlow } from "./customer-flow";
import { RentValue } from "./rent-value";
import styles from "./landing-demo.module.css";

type Frame = ReturnType<typeof chapterAt>;
export function Workspace({
  demo,
  frame,
  choice,
  reduced,
  area,
  mini,
  running,
  flowPaused,
  onArea,
  onProperty,
  onInterior,
  onExperiment,
  onChoice,
  onFlow,
  onReplay,
}: {
  demo: LandingDemoData;
  frame: Frame;
  choice: ExperimentChoice;
  reduced: boolean;
  area: string;
  mini: boolean;
  running: boolean;
  flowPaused: boolean;
  onArea: () => void;
  onProperty: () => void;
  onInterior: () => void;
  onExperiment: () => void;
  onChoice: (choice: ExperimentChoice) => void;
  onFlow: () => void;
  onReplay: () => void;
}) {
  const experiment = frame.scene === "experiment";
  const focused = frame.chapter !== "location";
  const title = experiment
    ? "Test the decision."
    : focused
      ? "Test this location."
      : "Compare locations.";
  const setup = demo.experiment[choice];
  const heights = !focused && area === "heights";
  const property = heights ? demo.shortlist.heights : demo.property;
  return (
    <div
      className={styles.workspace}
      data-mini={mini}
      data-workspace-scene={frame.scene}
    >
      <header className={styles.workspaceHeading}>
        <WordHeading text={title} />
        <span>Example · modeled, not a forecast</span>
      </header>
      <div className={styles.workspaceGrid}>
        <Glass className={styles.consultantRail}>
          <header>
            <span className={styles.assistantIcon}>
              <Icon name="sparkle" />
            </span>
            <strong>Consultant</strong>
            <small>Demo</small>
          </header>
          <div className={styles.demoPrompt}>
            <span>Your brief</span>
            <p>
              {demo.business.category} in {demo.business.city}.<br />
              Under {dollars(demo.business.rentLimit)} / month.
            </p>
          </div>
          <div className={styles.findings} key={`${frame.chapter}-${choice}`}>
            <span className={styles.railLabel}>
              {experiment
                ? "Counter experiment"
                : focused
                  ? "Starting assumptions"
                  : "Shortlist"}
            </span>
            {(experiment
              ? [
                  choice === "current"
                    ? "1 staffed counter"
                    : "2 staffed counters",
                  `${setup.served} customers served`,
                  `${setup.p90WaitMin?.toFixed(1) ?? "—"} min p90 wait`,
                ]
              : focused
                ? [
                    demo.property.area,
                    "Within budget",
                    `${number(property.size)} sq ft`,
                  ]
                : ["Montrose", "The Heights"]
            ).map((finding, i) => (
              <div
                className={styles.finding}
                key={finding}
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <Icon name="check" />
                <span>{finding}</span>
              </div>
            ))}
          </div>
          {experiment && (
            <div className={styles.demoPrompt}>
              <span>Your question</span>
              <p>What if I add a second staffed counter?</p>
            </div>
          )}
          <div className={styles.railAction}>
            {experiment ? (
              <button
                type="button"
                onClick={() =>
                  onChoice(choice === "current" ? "proposed" : "current")
                }
              >
                {choice === "current"
                  ? "Add a staffed counter"
                  : "Compare current setup"}
                <Icon name="arrow" />
              </button>
            ) : (
              <button
                type="button"
                onClick={focused ? onExperiment : onProperty}
              >
                {focused ? "Test the setup" : "Use Montrose"}
                <Icon name="arrow" />
              </button>
            )}
          </div>
        </Glass>
        <div className={styles.sandbox}>
          <div className={styles.sandboxBar}>
            <span>{focused ? demo.property.name : "Houston shortlist"}</span>
            <span>
              {experiment
                ? `${setup.stations} staffed counter${setup.stations === 1 ? "" : "s"}`
                : frame.scene === "interior"
                  ? "Current setup"
                  : "Illustrative view"}
            </span>
          </div>
          <div className={styles.sceneCanvas}>
            <SceneImage
              file="map-v1.png"
              alt="Illustrative Houston location shortlist"
              opacity={frame.mapOpacity}
              zoom={1 + frame.mapPush * 0.8}
              origin="79% 77%"
              panX={-29 * frame.mapPush}
              panY={-27 * frame.mapPush}
            />
            <SceneImage
              file="location-close-v2.png"
              alt="Closer illustrative view of the selected Montrose corner building"
              opacity={frame.closeOpacity}
              zoom={1 + frame.mapPush * 0.08}
            />
            <SceneImage
              file="cafe-exterior-v2.png"
              alt="Illustrative street exterior of the Montrose café"
              opacity={frame.exteriorOpacity}
              zoom={frame.exteriorZoom}
            />
            <SceneImage
              file="cafe-interior-v1.png"
              alt="Illustrative starting café interior with green tile and walnut counter"
              opacity={frame.interiorOpacity}
            />
            <SceneImage
              file="cafe-overhead-one-counter-v2.png"
              alt="Illustrative overhead café with one staffed checkout"
              opacity={choice === "current" ? frame.overheadOpacity : 0}
              contain
            />
            <SceneImage
              file="cafe-overhead-two-counters-v3.png"
              alt="Illustrative café with the original service bar and a separate second counter island"
              opacity={choice === "proposed" ? frame.overheadOpacity : 0}
              contain
            />
            {experiment && (
              <CustomerFlow
                key={choice}
                proposed={choice === "proposed"}
                running={running}
              />
            )}
            {frame.chapter === "location" && (
              <div
                className={styles.mapMarkers}
                style={{ opacity: 1 - frame.mapPush }}
              >
                <button
                  className={styles.selectedMarker}
                  type="button"
                  aria-pressed={area === "montrose"}
                  onClick={onProperty}
                >
                  <Icon name="pin" />
                  Montrose
                </button>
                <button
                  className={styles.otherMarker}
                  type="button"
                  aria-pressed={area === "heights"}
                  onClick={onArea}
                >
                  The Heights
                </button>
              </div>
            )}
            <span className={styles.artworkLabel}>Illustrative demo</span>
          </div>
        </div>
        <Glass className={styles.inspector}>
          {experiment ? (
            <>
              <span className={styles.railLabel}>Counter experiment</span>
              <div
                className={styles.setupToggle}
                role="group"
                aria-label="Compare staffed counter setups"
              >
                <button
                  type="button"
                  aria-pressed={choice === "current"}
                  onClick={() => onChoice("current")}
                >
                  One counter
                </button>
                <button
                  type="button"
                  aria-pressed={choice === "proposed"}
                  onClick={() => onChoice("proposed")}
                >
                  Two counters
                </button>
              </div>
              <div className={styles.flowControls}>
                <button
                  type="button"
                  onClick={onFlow}
                  aria-label={
                    flowPaused
                      ? "Resume illustrative customer flow"
                      : "Pause illustrative customer flow"
                  }
                >
                  <Icon name={flowPaused ? "play" : "pause"} />
                </button>
                <button
                  type="button"
                  onClick={onReplay}
                  aria-label="Replay the counter comparison"
                >
                  <Icon name="replay" />
                </button>
                <span>{demo.experiment.period}</span>
              </div>
              <dl className={styles.results}>
                <div>
                  <dt>Customers served</dt>
                  <dd>{setup.served}</dd>
                </div>
                <div>
                  <dt>P90 wait</dt>
                  <dd>
                    {setup.p90WaitMin?.toFixed(1) ?? "—"}
                    <small> min</small>
                  </dd>
                </div>
                <div>
                  <dt>Staffing cost</dt>
                  <dd>{dollars(setup.laborUsd)}</dd>
                </div>
              </dl>
              <div className={styles.contribution}>
                <span>Daily equivalent contribution</span>
                <strong>{dollars(setup.contributionUsd)}</strong>
              </div>
              {choice === "proposed" && (
                <p className={styles.costDelta}>
                  +
                  {dollars(
                    demo.experiment.proposed.laborUsd -
                      demo.experiment.current.laborUsd,
                  )}{" "}
                  morning labor
                  <br />+{dollars(demo.experiment.additionalBuildoutUsd)} setup
                </p>
              )}
              <details className={styles.source}>
                <summary>
                  Same {demo.experiment.arrivals} generated customers
                </summary>
                <p>
                  {demo.source}. Decorative paths illustrate flow, not
                  individual replay events.{" "}
                  {demo.experiment.definitions.p90WaitMin}{" "}
                  {demo.experiment.definitions.contributionUsd} Added buildout:{" "}
                  {dollars(demo.experiment.additionalBuildoutUsd)}.
                </p>
              </details>
            </>
          ) : (
            <>
              <span className={styles.railLabel}>
                {focused ? "Starting assumptions" : "Your shortlist"}
              </span>
              <h3>{property.name}</h3>
              <dl className={styles.propertyFacts}>
                <div className={styles.rentFact}>
                  <dt>Rent assumption</dt>
                  <dd>
                    <RentValue
                      key={focused ? "selected" : area}
                      target={property.rent}
                      animate={focused}
                      reduced={reduced}
                    />
                    <small>/ month</small>
                  </dd>
                </div>
                <div>
                  <dt>Floor area</dt>
                  <dd>
                    {number(property.size)} <small>sq ft</small>
                  </dd>
                </div>
                <div>
                  <dt>Area</dt>
                  <dd>{property.area.split(",")[0]}</dd>
                </div>
                {frame.scene === "interior" && (
                  <>
                    <div>
                      <dt>Current counters</dt>
                      <dd>{demo.experiment.current.stations}</dd>
                    </div>
                    <div>
                      <dt>Current staff</dt>
                      <dd>{demo.experiment.current.staff}</dd>
                    </div>
                  </>
                )}
              </dl>
              <div className={styles.inspectorAction}>
                <button
                  className={styles.primary}
                  type="button"
                  onClick={
                    frame.scene === "interior"
                      ? onExperiment
                      : focused
                        ? onInterior
                        : onProperty
                  }
                >
                  {frame.scene === "interior"
                    ? "Test a change"
                    : focused
                      ? "Use as starting setup"
                      : heights
                        ? "Continue with Montrose"
                        : "Test this location"}
                  <Icon name="arrow" />
                </button>
              </div>
              <p className={styles.inspectorFoot}>
                Example space · generated views
              </p>
            </>
          )}
        </Glass>
      </div>
    </div>
  );
}
function SceneImage({
  file,
  alt,
  opacity,
  zoom = 1,
  origin = "50% 50%",
  contain = false,
  panX = 0,
  panY = 0,
}: {
  file: string;
  alt: string;
  opacity: number;
  zoom?: number;
  origin?: string;
  contain?: boolean;
  panX?: number;
  panY?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className={styles.sceneImage}
      style={{ opacity }}
      aria-hidden={opacity === 0}
      data-artwork={file}
    >
      {!failed ? (
        <Image
          src={`/landing-assets/guided-demo/${file}`}
          alt={alt}
          fill
          loading="eager"
          sizes="(max-width: 700px) 100vw, 70vw"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            objectFit: contain ? "contain" : "cover",
            transform: `translate3d(${panX}%, ${panY}%, 0) scale(${zoom})`,
            transformOrigin: origin,
          }}
        />
      ) : (
        <div className={styles.sceneFallback} role="status">
          Illustrative view unavailable
        </div>
      )}
      {!failed && !loaded && (
        <div className={styles.sceneFallback} role="status">
          Loading scene…
        </div>
      )}
    </div>
  );
}
