import { access } from "node:fs/promises";
import path from "node:path";
import type { QcContext, QcCheckResult } from "../types.js";

const REF_RE = /(?:src|href)="([^"]+)"|url\(([^)]+)\)/g;

function isSkippable(ref: string): boolean {
  return ref.startsWith("data:") || ref.startsWith("#") || /^https?:\/\//.test(ref);
}

/** Every asset the assembled book HTML references (img/src, svg href, CSS url()) must exist on disk. */
export async function checkAssetsExist(ctx: QcContext): Promise<QcCheckResult> {
  const id = "assets-exist";

  if (!ctx.bookHtml) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "No assembled html/<slug>-book.html found for this project — nothing to scan for asset references.",
    };
  }

  const refs = new Set<string>();
  for (const match of ctx.bookHtml.matchAll(REF_RE)) {
    const raw = (match[1] ?? match[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (raw && !isSkippable(raw)) refs.add(raw);
  }

  if (refs.size === 0) {
    return {
      id,
      status: "skipped",
      pass: false,
      evidence: "html/<slug>-book.html references no local assets (no <img>/svg href/CSS url() found).",
    };
  }

  const missing: string[] = [];
  for (const ref of refs) {
    const resolved = path.join(ctx.projectRoot, ref);
    try {
      await access(resolved);
    } catch {
      missing.push(ref);
    }
  }

  const pass = missing.length === 0;
  return {
    id,
    status: pass ? "pass" : "fail",
    pass,
    evidence: pass
      ? `All ${refs.size} referenced asset(s) exist on disk.`
      : `${missing.length}/${refs.size} referenced asset(s) missing: ${missing.join(", ")}.`,
    details: { checked: [...refs], missing },
  };
}
