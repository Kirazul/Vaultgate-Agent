// GET  /api/skills — list installed skills (name, description, source).
// POST /api/skills — create or delete a user skill (Inventory → Skills tab).
import type { NextRequest } from "next/server";
import { listSkillsWithSource, createUserSkill, importUserSkill, deleteUserSkill, readSkillSource } from "@/lib/runtime/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const name = new URL(request.url).searchParams.get("name");
  if (name) {
    const skill = readSkillSource(name);
    if (!skill) return Response.json({ error: "Skill not found" }, { status: 404 });
    return Response.json(skill);
  }
  return Response.json({ skills: listSkillsWithSource() });
}

type Body =
  | { action: "create"; name: string; description: string; instructions: string }
  | { action: "import"; content: string; filename?: string }
  | { action: "delete"; name: string };

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Body;

  if (body.action === "create") {
    const result = createUserSkill({ name: body.name ?? "", description: body.description ?? "", instructions: body.instructions ?? "" });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ skills: listSkillsWithSource(), created: result.name });
  }

  if (body.action === "import") {
    const result = importUserSkill(body.content ?? "", body.filename);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ skills: listSkillsWithSource(), created: result.name });
  }

  if (body.action === "delete") {
    const result = deleteUserSkill(body.name ?? "");
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ skills: listSkillsWithSource() });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
