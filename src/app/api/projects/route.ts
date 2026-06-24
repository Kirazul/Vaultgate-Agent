// GET /api/projects — list all projects.  POST /api/projects — create/update a project.
import type { NextRequest } from "next/server";
import { createProject, listProjects, updateProject, deleteProject, getProjectByPath } from "@/lib/db/repo";
import { uid } from "@/lib/utils";
import path from "node:path";
import { existsSync, statSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listProjects());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    action?: "create" | "update" | "delete";
    id?: string;
    name?: string;
    path?: string;
  };

  if (body.action === "delete" && body.id) {
    await deleteProject(body.id);
    return Response.json({ ok: true });
  }

  if (body.action === "update" && body.id) {
    await updateProject(body.id, { name: body.name, path: body.path });
    return Response.json({ ok: true });
  }

  // Default: create or reopen
  if (!body.path) {
    return Response.json({ error: "path is required" }, { status: 400 });
  }

  // Normalize and validate the path before trusting a cwd.
  const projectPath = path.resolve(body.path.replace(/[\\/]+$/, ""));
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    return Response.json({ error: "path must be an existing folder" }, { status: 400 });
  }

  // Check if a project with this path already exists
  const existing = await getProjectByPath(projectPath);
  if (existing) {
    return Response.json(existing);
  }

  // Derive name from folder if not given
  const name = body.name || projectPath.split(/[\\/]/).filter(Boolean).pop() || "Untitled";
  const project = await createProject({ id: body.id || uid(), name, path: projectPath });
  return Response.json(project, { status: 201 });
}
