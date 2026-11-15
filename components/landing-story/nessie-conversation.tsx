"use client";
import Image from "next/image";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Glass, Icon, dollars } from "../landing-demo/demo-ui";
import type { LocationStoryData } from "./location-data";
import { NESSIE_PROMPT, nessieAt } from "./nessie-story";
import styles from "./landing-story.module.css";

function NessieMark() {
  return (
    <Image
      src="/landing-assets/nessie-logo.svg"
      alt="Nessie"
      width={80}
      height={44}
      unoptimized
      className={styles.nessieLogo}
    />
  );
}
export function NessieConversation({
  data,
  elapsed,
  reduced,
  onSend,
  children,
}: {
  data: LocationStoryData;
  elapsed: number;
  reduced: boolean;
  onSend?: () => void;
  children: ReactNode;
}) {
  const chat = nessieAt(data, elapsed, reduced);
  const { example, stage } = chat;
  return (
    <div
      className={`${styles.conversation} ${styles.nessieConversation}`}
      data-nessie-stage={stage}
      data-chat-state={
        chat.complete ? "complete" : chat.sent ? "replying" : "composing"
      }
    >
      {!chat.sent && (
        <Glass className={styles.composer}>
          <label className={styles.composerLabel}>
            <span className={styles.srOnly}>Consultant question</span>
            <textarea
              aria-label="Consultant question"
              rows={2}
              readOnly
              value={chat.promptText}
              spellCheck={false}
            />
          </label>
          <div className={styles.composerFooter}>
            <button
              type="button"
              aria-label="Send example prompt"
              data-pressed={chat.sendPressed}
              onClick={onSend}
            >
              <Icon name="arrow" />
            </button>
          </div>
        </Glass>
      )}
      {chat.sent && (
        <Glass
          className={`${styles.bubble} ${styles.userBubble}`}
          data-speaker="user"
        >
          <span>You</span>
          <p>{NESSIE_PROMPT}</p>
        </Glass>
      )}
      {chat.sent && !chat.replyVisible && (
        <Glass
          className={styles.nessieWorkspace}
          aria-label="Nessie demo financial checks"
        >
          <header className={styles.nessieHeader}>
            <div className={styles.nessieBrand}>
              <NessieMark />
              <strong>Nessie</strong>
            </div>
            <span key={stage}>
              {stage === "checking"
                ? "Checking demo finances…"
                : stage === "snapshot"
                  ? "Start with available cash."
                  : "What would each space leave?"}
            </span>
          </header>
          {stage === "checking" ? (
            <div className={styles.nessieChecking} aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <i
                  key={index}
                  style={{
                    opacity: 0.6 + 0.4 * Math.sin(elapsed / 170 - index),
                    transform: `translateY(${-2 * Math.sin(elapsed / 170 - index)}px)`,
                  }}
                />
              ))}
            </div>
          ) : stage === "snapshot" ? (
            <div className={styles.nessieSnapshot}>
              <div>
                <span>Demo account balance</span>
                <strong>{dollars(example.cash)}</strong>
              </div>
              <p>
                Set aside <strong>{dollars(example.setup)}</strong> for setup,
                then three months of rent.
              </p>
            </div>
          ) : (
            <div className={styles.nessieComparison}>
              <p>Cash after setup + three months of rent</p>
              <div className={styles.nessieColumns}>
                {example.sites.map((site) => (
                  <div key={site.id}>
                    <h3>{site.name}</h3>
                    <strong>{dollars(site.remaining)}</strong>
                    <div className={styles.nessieTrack} aria-hidden="true">
                      <i
                        style={{
                          width: `${(site.remaining / example.cash) * 100}%`,
                        }}
                      />
                    </div>
                    <span>{dollars(site.rent)} / month rent</span>
                  </div>
                ))}
              </div>
              <p className={styles.nessieDifference}>
                Montrose preserves{" "}
                <strong>{dollars(example.difference)} more.</strong>
              </p>
            </div>
          )}
          <p className={styles.nessieDemoNote}>
            Simulated Nessie banking · authored demo
          </p>
        </Glass>
      )}
      {chat.replyVisible && (
        <Glass
          className={`${styles.bubble} ${styles.consultantBubble}`}
          data-speaker="bizbox"
        >
          <BrandLogo onDark className={styles.bubbleBrand} />
          <div aria-hidden="true" className={styles.replyParagraphs}>
            {chat.paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph || "\u00a0"}</p>
            ))}
          </div>
          <span className={styles.srOnly}>{example.replies.join(" ")}</span>
          <div className={styles.nessieAttribution}>
            <NessieMark />
            <span>Uses simulated Nessie financial data</span>
          </div>
          {chat.complete && (
            <>
              <details className={styles.nessieAssumptions}>
                <summary>Demo assumptions</summary>
                <p>
                  Authored simulated balance: {dollars(example.cash)}. Deduct{" "}
                  {dollars(example.setup)} setup and three months of each
                  property’s example rent. Excludes ingredients, labor,
                  utilities, taxes and other operating costs. Remaining cash is
                  not profit, runway or financing approval. No bank account is
                  connected.
                </p>
              </details>
              {children}
            </>
          )}
        </Glass>
      )}
    </div>
  );
}
