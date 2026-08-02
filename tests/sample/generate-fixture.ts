/**
 * Regenerates tests/sample/mini-source.pdf: a 3-page fixture mimicking a
 * Synthesise AI export (Introduction / CHAPTER 01 with a numbered list and a
 * small table / BONUS - Test Checklist), built through the same render engine
 * (src/render) used for real ebooks — never hand-authored bytes.
 *
 * Run: npx tsx tests/sample/generate-fixture.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToPdf } from "../../src/render/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const css = [`
  @page { size: 6in 9in; margin: 0.75in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.5; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 0.3em; }
  h2 { font-size: 14pt; margin: 0 0 0.6em; font-weight: normal; font-style: italic; }
  p { margin: 0 0 0.9em; }
  table { border-collapse: collapse; margin: 0.6em 0; }
  td, th { padding: 6px 28px 6px 0; text-align: left; white-space: nowrap; }
  .section { break-before: page; }
  .section:first-of-type { break-before: avoid; }
`];

const bodyHtml = `
<div class="section">
  <h1>Introduction</h1>
  <p>This is the introduction paragraph of the mini source fixture used to validate the studio:ingest pipeline end to end, checking that an ordinary body paragraph is reconstructed correctly even when it wraps across more than one printed line inside the PDF.</p>
</div>

<div class="section">
  <h1>CHAPTER 01</h1>
  <h2>Getting Started</h2>
  <p>This chapter walks through the basic onboarding steps before diving into the details covered later in the book.</p>
  <p>1. Create your account and verify your email address.</p>
  <p>2. Complete your profile with a photo and a short bio.</p>
  <p>3. Read the community guidelines before your first post.</p>
  <table>
    <tr><th>Step</th><th>Time Required</th><th>Difficulty</th></tr>
    <tr><td>Setup</td><td>5 minutes</td><td>Easy</td></tr>
    <tr><td>Configure</td><td>10 minutes</td><td>Medium</td></tr>
  </table>
</div>

<div class="section">
  <h1>BONUS - Test Checklist</h1>
  <p>1. Confirm the chapter markers were detected correctly.</p>
  <p>2. Confirm the numbered list survived extraction intact.</p>
  <p>3. Confirm the table rows kept their columns separated.</p>
</div>
`;

const outputPdfPath = path.join(__dirname, "mini-source.pdf");

const result = await renderToPdf({
  bodyHtml,
  css,
  outputPdfPath,
  title: "Ebook Studio — mini source fixture",
});

console.log(`Wrote ${result.pdfPath} (${result.pageCount} pages)`);
