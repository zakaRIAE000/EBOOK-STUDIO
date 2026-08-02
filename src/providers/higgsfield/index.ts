import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  ImageProviderAuthError,
  ImageProviderError,
  type AuthStatus,
  type GeneratedImage,
  type ImageGenerationRequest,
  type ImageProvider,
  type OutputSpec,
  type OutputSpecPaths,
} from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Active ImageProvider implementation. Shells out to the `higgsfield` binary
 * as a subprocess — NOT the generic Higgsfield MCP connector, which
 * currently fails OAuth. The CLI is Higgsfield's own recommended path for
 * Claude Code and is expected to already be installed + authenticated on
 * the machine running this (see .claude/skills/higgsfield-generate/SKILL.md
 * for the exact command surface this mirrors).
 */
export class HiggsfieldCliProvider implements ImageProvider {
  constructor(private readonly binary: string = "higgsfield") {}

  async checkAuth(): Promise<AuthStatus> {
    try {
      const { stdout, stderr } = await execFileAsync(this.binary, ["account", "status"]);
      const combined = `${stdout}\n${stderr}`;
      if (/session expired|not authenticated/i.test(combined)) {
        return notAuthenticated();
      }
      return { authenticated: true, detail: stdout.trim() || "Higgsfield CLI session is active." };
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      if (nodeErr.code === "ENOENT") {
        return {
          authenticated: false,
          detail:
            'The "higgsfield" CLI is not on PATH. Install it: curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh',
        };
      }
      const combined = `${nodeErr.stdout ?? ""}\n${nodeErr.stderr ?? ""}`;
      if (/session expired|not authenticated/i.test(combined)) {
        return notAuthenticated();
      }
      return {
        authenticated: false,
        detail: `"higgsfield account status" failed: ${combined.trim() || nodeErr.message}`,
      };
    }
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const auth = await this.checkAuth();
    if (!auth.authenticated) {
      throw new ImageProviderAuthError(auth.detail);
    }

    const requestedAt = new Date().toISOString();
    const args = ["generate", "create", request.model, "--prompt", request.prompt];
    if (request.aspectRatio) args.push("--aspect_ratio", request.aspectRatio);
    if (request.resolution) args.push("--resolution", request.resolution);
    for (const ref of request.referenceImages ?? []) args.push("--image", ref);
    args.push("--wait", "--json");

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(this.binary, args, { maxBuffer: 1024 * 1024 * 32 }));
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      if (nodeErr.code === "ENOENT") {
        throw new ImageProviderError(
          'The "higgsfield" CLI is not on PATH. Install it: curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh',
        );
      }
      throw new ImageProviderError(
        `"higgsfield generate create ${request.model}" failed: ${(nodeErr.stderr ?? nodeErr.message ?? "").toString().trim()}`,
      );
    }

    let job: unknown;
    try {
      job = JSON.parse(stdout);
    } catch {
      throw new ImageProviderError(
        `Could not parse JSON from "higgsfield generate create ${request.model} --wait --json". Raw output: ${stdout.slice(0, 2000)}`,
      );
    }

    const mediaUrl = findMediaUrl(job);
    if (!mediaUrl) {
      throw new ImageProviderError(
        `Generation for "${request.outputName}" completed but no media URL could be found in the CLI's JSON output — inspect the raw job manually. Raw job: ${JSON.stringify(job).slice(0, 2000)}`,
      );
    }

    await mkdir(request.outputDir, { recursive: true });
    const rawPath = await downloadToFile(mediaUrl, path.join(request.outputDir, `${request.outputName}.raw`));
    const completedAt = new Date().toISOString();

    const outputs: OutputSpecPaths = {};
    for (const spec of request.outputSpecs ?? []) {
      outputs[spec] = await convertToSpec(rawPath, spec, request.outputDir, request.outputName);
    }

    const result: GeneratedImage = {
      purpose: request.purpose,
      model: request.model,
      prompt: request.prompt,
      requestedAt,
      completedAt,
      rawPath,
      outputs,
    };

    await appendLog(request.logPath, result);
    return result;
  }
}

function notAuthenticated(): AuthStatus {
  return {
    authenticated: false,
    detail: 'Higgsfield CLI session expired or not authenticated. Run "higgsfield auth login" and try again.',
  };
}

/**
 * The CLI's `--json` job shape isn't pinned down in our docs, so this walks
 * the parsed object looking for a plausible media URL rather than assuming
 * one exact field path. Priority keys are tried first; anything else is a
 * last-resort scan. If nothing is found the caller throws with the raw JSON
 * attached (R8: never guess a wrong field and silently ship an empty image).
 */
function findMediaUrl(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMediaUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const priorityKeys = [
      "result_url", "output_url", "media_url", "image_url", "url",
      "results", "outputs", "output", "media", "assets", "result",
    ];
    for (const key of priorityKeys) {
      if (key in record) {
        const found = findMediaUrl(record[key], depth + 1);
        if (found) return found;
      }
    }
    for (const nested of Object.values(record)) {
      const found = findMediaUrl(nested, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function downloadToFile(url: string, destPathNoExt: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ImageProviderError(`Failed to download generated image from ${url}: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : path.extname(new URL(url).pathname).replace(".", "") || "png";
  const destPath = `${destPathNoExt}.${ext}`;
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  return destPath;
}

const OUTPUT_SPEC_DIMENSIONS: Record<OutputSpec, { width: number; height: number; density?: number }> = {
  // Kindle storefront listing size.
  kindle: { width: 1600, height: 2560 },
  // 6x9in at 300dpi — the physical print cover used in the assembled PDF.
  print: { width: 1800, height: 2700, density: 300 },
};

async function convertToSpec(rawPath: string, spec: OutputSpec, outputDir: string, outputName: string): Promise<string> {
  const { width, height, density } = OUTPUT_SPEC_DIMENSIONS[spec];
  const outPath = path.join(outputDir, `${outputName}.${spec}.png`);
  let pipeline = sharp(rawPath).resize(width, height, { fit: "cover", position: "attention" });
  if (density) pipeline = pipeline.withMetadata({ density });
  await pipeline.png().toFile(outPath);
  return outPath;
}

async function appendLog(logPath: string, entry: GeneratedImage): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  let existing: GeneratedImage[] = [];
  try {
    existing = JSON.parse(await readFile(logPath, "utf-8")) as GeneratedImage[];
  } catch {
    existing = [];
  }
  existing.push(entry);
  await writeFile(logPath, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
}
