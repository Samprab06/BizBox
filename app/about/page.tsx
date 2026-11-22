import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import styles from "./project.module.css";

export const metadata: Metadata = {
  title: "About BizBox",
  description:
    "See how BizBox combines real storefront listings with simulations to help founders compare locations and operating decisions.",
};

export default function AboutBizBox() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="BizBox home">
          <BrandLogo onDark />
        </Link>
        <Link className={styles.primary} href="/start" prefetch={false}>
          Open BizBox
        </Link>
      </header>

      <section className={styles.intro} aria-labelledby="project-title">
        <h1 id="project-title">Test the business before you sign the lease.</h1>
        <p>
          BizBox helps founders compare real storefronts in Houston and Los
          Angeles. Describe the business you want to open, explore candidate
          spaces, and see how staffing, hours, and layout affect a modeled day
          at each location.
        </p>
      </section>

      <div className={styles.cities}>
        <figure className={styles.city}>
          <Image
            src="/onboarding/houston-real.jpg"
            alt="Downtown Houston skyline"
            fill
            sizes="(max-width: 620px) 92vw, 50vw"
          />
          <figcaption>Houston</figcaption>
        </figure>
        <figure className={styles.city}>
          <Image
            src="/onboarding/la-real.jpg"
            alt="Los Angeles at night from Griffith Observatory"
            fill
            sizes="(max-width: 620px) 92vw, 50vw"
          />
          <figcaption>Los Angeles</figcaption>
        </figure>
      </div>
      <p className={styles.credit}>
        <a href="/workspace/credits.html">City photo credits</a>
      </p>

      <section className={styles.details} aria-labelledby="what-you-can-test">
        <h2 id="what-you-can-test">What you can test</h2>
        <div className={styles.steps}>
          <article>
            <h3>Compare storefronts</h3>
            <p>
              Start with your concept, customers, and budget. Compare CoStar
              listings alongside neighborhood demographics, nearby workplaces,
              and competing businesses.
            </p>
          </article>
          <article>
            <h3>Replay a day</h3>
            <p>
              Watch modeled customers arrive, queue, and get served. See how the
              same operation could play out at different locations.
            </p>
          </article>
          <article>
            <h3>Try a change</h3>
            <p>
              Try an extra counter or a different staffing plan. Review how the
              assumptions change wait times, capacity, and modeled costs, then
              export a location plan.
            </p>
          </article>
        </div>
        <p className={styles.assumptions}>
          Simulations use stated assumptions and reproducible scenarios.
          Comparisons show ranges and how sensitive the results are to your
          inputs.
        </p>
      </section>

      <section className={styles.details} aria-labelledby="how-we-built-it">
        <h2 id="how-we-built-it">Built at HackPrinceton</h2>
        <p>
          We built BizBox in 36 hours. We’re proud that the property data,
          simulation, and 3D replay all help answer the same question. Would
          changing the location or the operation change the decision?
        </p>
        <p>
          We also built{" "}
          <a href="https://github.com/Samprab06/agentorch">Agentorch</a> to
          coordinate our coding agents. We shared tasks in Linear, ran jobs on
          an Oracle server, and used Hermes on Telegram to check progress and
          steer work from our phones.
        </p>
        <a href="https://devpost.com/software/bizbox">
          See our HackPrinceton submission
        </a>
      </section>
    </main>
  );
}
