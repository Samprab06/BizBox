import { missingFields, type IntakeSession, type Profile } from "./profile";

/** Form coverage is not full-profile completeness; only the agent supplies that verdict. */
export function intakeReadiness(
  session: IntakeSession,
  drafts: Partial<Record<keyof Profile, string | undefined>> = {},
) {
  // Invalid edits stay local in the form; include them in readiness without persisting them.
  const displayed = Object.entries(drafts).reduce(
    (profile, [key, value]) =>
      value === undefined
        ? profile
        : { ...profile, [key]: { value, origin: "founder" as const } },
    session.profile,
  );
  const missing = missingFields(displayed);
  const missingRequiredFields = session.live?.missingRequiredFields ?? null;
  const formStatus = missing.length
    ? `Still needed: ${missing.map((field) => field.label).join(", ")}.`
    : "Form fields are filled.";
  if (missingRequiredFields?.length) {
    const remaining = missingRequiredFields.some(
      (field) => field === "economics" || field.startsWith("economics."),
    )
      ? "economics"
      : "profile details";
    return {
      complete: false,
      missingRequiredFields,
      message: `${formStatus} The assistant will ask for the remaining ${remaining} in chat.`,
    };
  }
  if (missing.length)
    return { complete: false, missingRequiredFields, message: formStatus };
  if (missingRequiredFields === null)
    return {
      complete: false,
      missingRequiredFields,
      message: `${formStatus} The assistant has not reviewed the full profile yet. Continue in chat for any remaining details, including economics.`,
    };
  if (session.pending?.length)
    return {
      complete: false,
      missingRequiredFields,
      message: `${formStatus} Your latest edits are awaiting the assistant's review.`,
    };
  return {
    complete: true,
    missingRequiredFields,
    message: "All required fields are filled.",
  };
}
