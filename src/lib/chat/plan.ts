// Plan-mode lifecycle helpers shared by the client (composer/PlanCard) and the
// server agent loop. Pure module — safe to import from both.
//
// Mirrors how Claude Code handles plan approval: when the user approves a plan,
// the agent receives an unmissable "you have exited plan mode" instruction (the
// "plan_mode_exit attachment") so it implements the approved plan and never
// re-plans or asks for another plan. The directive carries the EXACT saved plan
// path so the agent reads it in one shot instead of guessing/searching for it.

/** Base text the PlanCard sends when the user clicks "Approve". */
const APPROVAL_BASE = "Approved — implement this plan exactly as written, in order, verifying as you go.";

/** Build the approval message, embedding the saved plan path when known so the
 *  server can thread the exact path into the implementation directive. */
export function planApprovalMessage(planFile?: string): string {
  return planFile ? `${APPROVAL_BASE}\n\n(Approved plan file: ${planFile})` : APPROVAL_BASE;
}

/** Back-compat constant for callers that don't have a path. */
export const PLAN_APPROVAL_MESSAGE = APPROVAL_BASE;

/** Detect a plan-approval message (the user accepted the presented plan). */
export function isPlanApprovalMessage(text: string): boolean {
  return /^approved\b/i.test(text.trim()) && /\bplan\b/i.test(text);
}

/** Pull the saved plan path back out of an approval message, if present. */
export function extractApprovedPlanPath(text: string): string | undefined {
  return text.match(/Approved plan file:\s*(\S+)/i)?.[1];
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
