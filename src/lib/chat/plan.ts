// Plan-mode lifecycle helpers shared by the client (composer/PlanCard) and the
// server agent loop. Pure module — safe to import from both.
//
// What the user sees in chat is intentionally short ("Approved." /
// "Revise the plan." plus a small plan-file footer). The verbose
// implementation directive the model needs to see is appended server-side by
// `planImplementationDirective`, so the chat transcript stays clean.

/** Short, user-facing approval text. */
const APPROVAL_BASE = "Approved.";

/** Build the approval message, embedding the saved plan path when known so the
 *  server can thread the exact path into the implementation directive. */
export function planApprovalMessage(planFile?: string): string {
  return planFile ? `${APPROVAL_BASE}\n\n(plan: ${planFile})` : APPROVAL_BASE;
}

/** Back-compat constant for callers that don't have a path. */
export const PLAN_APPROVAL_MESSAGE = APPROVAL_BASE;

/** Detect a plan-approval message (the user accepted the presented plan). */
export function isPlanApprovalMessage(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed === "approved." || trimmed === "approved" || trimmed.startsWith("approved.\n") || trimmed.startsWith("approved\n");
}

/** Pull the saved plan path back out of an approval message, if present. */
export function extractApprovedPlanPath(text: string): string | undefined {
  return text.match(/\(plan:\s*(\S+?)\)/i)?.[1] ?? text.match(/Approved plan file:\s*(\S+)/i)?.[1];
}

/** Short, user-facing revise text. The full "redraft the plan via the Plan
 *  tool" instruction is injected on the server, mirroring the approval flow. */
export function planRevisionMessage(feedback: string): string {
  return `Revise the plan.\n\n${feedback.trim()}`;
}

/** Detect a plan-revision message (the user asked for changes to the plan). */
export function isPlanRevisionMessage(text: string): boolean {
  return /^revise the plan\b/i.test(text.trim());
}

/**
 * The "plan_mode_exit attachment" — what the model actually sees as the latest
 * instruction once a plan is approved. Anchors it firmly in implementation mode
 * and points it straight at the saved plan file (no searching).
 */
export function planImplementationDirective(planFile?: string): string {
  const readStep = planFile
    ? `- The approved plan is saved at \`${planFile}\` — Read that exact file first so the steps are in your context.`
    : "- If you saved the plan to a file, Read it first so the exact approved steps are in your context.";
  return [
    "The plan you presented has been APPROVED by the user. You have now EXITED plan mode and are in implementation mode.",
    "",
    "Implement the approved plan now:",
    readStep,
    "- Execute every step in order, verifying as you go (builds, tests, commands).",
    "- Use TodoWrite (or Kanban for longer work) to track the steps and mark each complete as you finish it.",
    "- Do NOT call the Plan tool again and do NOT ask for another plan — the plan is already approved. Just build it.",
    "- If you discover something mid-implementation that genuinely invalidates the plan, stop and tell the user before continuing.",
  ].join("\n");
}

/** Server-side directive shown to the model when the user requested changes —
 *  mirrors planImplementationDirective so the verbose instruction lives here,
 *  not in the chat transcript. */
export function planRevisionDirective(): string {
  return [
    "The user has requested CHANGES to the plan you presented. You are still in plan mode.",
    "",
    "- Revise the plan based on the feedback below, then call the Plan tool again with the updated plan for approval.",
    "- Do NOT start implementing yet — wait for the next approval.",
  ].join("\n");
}
