/**
 * The only door to image generation in the whole pipeline (R4). Diagrams
 * never come through here — those are deterministic SVG (skills/infographics).
 * This interface exists so the active implementation (Higgsfield CLI today)
 * can be swapped without touching an agent or command that calls it.
 */

export type ImagePurpose =
  | "cover-concept"
  | "cover-final"
  | "cover-back"
  | "bonus-mini-cover"
  | "ambient-illustration";

export type OutputSpec = "kindle" | "print";

export interface ImageGenerationRequest {
  /** What this image is for — purely informational, logged verbatim; the provider does not branch on it. */
  purpose: ImagePurpose;
  /** The exact literal prompt sent to the model — logged verbatim (R8: the prompt that produced a given image must be provable). */
  prompt: string;
  /** Higgsfield model / job_set_type id, e.g. "gpt_image_2", "nano_banana_pro". */
  model: string;
  aspectRatio?: string;
  resolution?: string;
  /** Local file paths or Higgsfield upload/job ids used as visual references. */
  referenceImages?: string[];
  /** Filename stem (no extension) for the saved output, e.g. "concept-a-dark-gold". */
  outputName: string;
  /** Absolute path to the directory the raw image (and any converted specs) get written to. */
  outputDir: string;
  /** Absolute path to the JSON log this generation gets appended to (created if missing). */
  logPath: string;
  /**
   * Which output specs to produce from the raw generation, if any. Omit for
   * cheap iteration (concepts, ambient illustrations) — only the
   * human-approved final normally needs converted specs (cost discipline).
   */
  outputSpecs?: OutputSpec[];
}

export interface OutputSpecPaths {
  /** 1600x2560px — Kindle storefront listing size. */
  kindle?: string;
  /** 6x9in at 300dpi (1800x2700px) — the physical print cover used in the assembled PDF. */
  print?: string;
}

export interface GeneratedImage {
  purpose: ImagePurpose;
  model: string;
  prompt: string;
  requestedAt: string;
  completedAt: string;
  /** The raw file as returned by the provider, before any output-spec conversion. */
  rawPath: string;
  outputs: OutputSpecPaths;
}

export interface AuthStatus {
  authenticated: boolean;
  /** Human-readable detail — either confirmation or the exact remediation step. */
  detail: string;
}

export interface ImageProvider {
  /** Never throws — always resolves to a real, checked status (R8: never crash silently on an auth problem). */
  checkAuth(): Promise<AuthStatus>;
  /** Must call checkAuth() first and throw ImageProviderAuthError with a clear remediation message if not authenticated. */
  generate(request: ImageGenerationRequest): Promise<GeneratedImage>;
}

export class ImageProviderError extends Error {}
export class ImageProviderAuthError extends ImageProviderError {}
