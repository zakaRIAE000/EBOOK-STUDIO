import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Inventory } from "../ingest/index.js";
import type { ProjectConfig } from "../design/index.js";

/**
 * Everything a check needs, assembled once by run.ts (one PDF parse, one set
 * of file reads) rather than each of the 14 checks repeating the same I/O.
 */
export interface QcContext {
  projectSlug: string;
  projectRoot: string;
  repoRoot: string;

  outputPdfPath: string;
  pdfBytes: Buffer;
  pdfDoc: PDFDocumentProxy;
  pageCount: number;
  /** Extracted text layer, one entry per page, in reading order. */
  pageTexts: string[];
  fullText: string;

  inventory: Inventory;
  resolvedConfig: ProjectConfig;
  tokensCss: string;

  /** Assembled full-book HTML (html/<slug>-book.html), if present. */
  bookHtml: string | null;
  bookHtmlPath: string | null;

  previewsDir: string;
  /** Absolute paths to previews/page-*.png, sorted in page order. */
  previewPaths: string[];
}

export type QcStatus = "pass" | "fail" | "skipped";

export interface QcCheckResult {
  id: string;
  status: QcStatus;
  /** true only for status "pass" — kept as a plain boolean per the {id, pass, evidence} contract. */
  pass: boolean;
  /** Human-readable proof of what was measured (R8: prose is never the proof by itself, this documents the measurement that is). */
  evidence: string;
  details?: unknown;
}

export type QcCheck = (ctx: QcContext) => Promise<QcCheckResult>;

export interface AestheticScore {
  total: number;
  max: 100;
  breakdown: {
    content: number;
    typography: number;
    layout: number;
    consistency: number;
    technical: number;
    nicheFit: number;
  };
  notes: string[];
}

export interface QcReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  outputPdfPath: string;
  pageCount: number;
  checks: QcCheckResult[];
  overallPass: boolean;
  aesthetic: AestheticScore;
}
