import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface ExtractedPdfResult {
  pageCount: number;
  extractedText: string;
  wordCount: number;
  renderedPageImages: string[];
  pdfJsExtracted: boolean;
}

function base64DataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodePdfLiteralString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) =>
      String.fromCharCode(parseInt(oct, 8))
    );
}

async function decompressBytes(
  compressed: Uint8Array,
  format: "deflate" | "deflate-raw"
): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    void writer.write(compressed as unknown as BufferSource);
    void writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}

async function fallbackExtractFlatePdfText(
  bytes: Uint8Array
): Promise<{ pageCount: number; extractedText: string }> {
  const decoder = new TextDecoder("latin1");
  const raw = decoder.decode(bytes);
  const pageMatches = raw.match(/\/Type\s*\/Page\b/g);
  const pageCount = Math.max(1, pageMatches ? pageMatches.length : 1);

  const pieces: string[] = [];

  // Find stream ... endstream blocks and attempt inflate decompression
  const streamRegex = /stream\r?\n/g;
  let match: RegExpExecArray | null = null;
  let streamCount = 0;

  while ((match = streamRegex.exec(raw)) !== null && streamCount < 80) {
    const startOffset = match.index + match[0].length;
    const endIdx = raw.indexOf("endstream", startOffset);
    if (endIdx <= startOffset) continue;
    streamCount++;

    let endOffset = endIdx;
    if (raw[endOffset - 1] === "\n") endOffset--;
    if (raw[endOffset - 1] === "\r") endOffset--;

    const slice = bytes.subarray(startOffset, endOffset);
    const inflated =
      (await decompressBytes(slice, "deflate")) ||
      (await decompressBytes(slice.subarray(2), "deflate-raw"));
    const contentStr = inflated ? decoder.decode(inflated) : decoder.decode(slice);

    // Extract text inside (...) Tj or [(...)] TJ operators
    const litRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let litMatch: RegExpExecArray | null = null;
    while ((litMatch = litRegex.exec(contentStr)) !== null) {
      const decoded = decodePdfLiteralString(litMatch[1]).trim();
      if (decoded.length >= 2 && /[a-zA-Z0-9]/.test(decoded)) {
        pieces.push(decoded);
      }
    }
  }

  const combined = pieces
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24000);

  return { pageCount, extractedText: combined };
}

export async function extractPdfContent(
  input: ArrayBuffer | Uint8Array | string
): Promise<ExtractedPdfResult> {
  let uint8: Uint8Array;
  if (typeof input === "string") {
    if (input.startsWith("blob:") || input.startsWith("http://") || input.startsWith("https://")) {
      const resp = await fetch(input);
      const buf = await resp.arrayBuffer();
      uint8 = new Uint8Array(buf);
    } else {
      uint8 = base64DataUrlToUint8Array(input);
    }
  } else {
    uint8 = new Uint8Array(input);
  }

  try {
    // Pass a copy because PDF.js transfers the underlying ArrayBuffer to its worker
    const loadingTask = pdfjsLib.getDocument({
      data: uint8.slice(0),
      useSystemFonts: true,
      isEvalSupported: true,
      cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
      cMapPacked: true,
      standardFontDataUrl:
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
    });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages || 1;
    const maxPagesToRead = Math.min(numPages, 40);
    const pageTexts: string[] = [];
    const renderedPageImages: string[] = [];

    for (let pageNum = 1; pageNum <= maxPagesToRead; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      interface PositionedTextItem {
        str: string;
        x: number;
        y: number;
        hasEOL?: boolean;
      }

      const items: PositionedTextItem[] = [];
      for (const rawItem of textContent.items) {
        if ("str" in rawItem && typeof rawItem.str === "string") {
          const transform = Array.isArray(rawItem.transform)
            ? rawItem.transform
            : [1, 0, 0, 1, 0, 0];
          items.push({
            str: rawItem.str,
            x: Number(transform[4] || 0),
            y: Number(transform[5] || 0),
            hasEOL: Boolean(rawItem.hasEOL),
          });
        }
      }

      // Group items into horizontal lines by Y coordinate (tolerance 3.5 pt)
      const lines: Array<{ y: number; items: PositionedTextItem[] }> = [];
      for (const item of items) {
        if (!item.str.trim() && !item.hasEOL) continue;
        let targetLine = lines.find((l) => Math.abs(l.y - item.y) <= 3.5);
        if (!targetLine) {
          targetLine = { y: item.y, items: [] };
          lines.push(targetLine);
        }
        targetLine.items.push(item);
      }

      // Sort lines top-to-bottom (descending Y in PDF coordinate space)
      lines.sort((a, b) => b.y - a.y);

      const formattedLines = lines
        .map((line) => {
          line.items.sort((a, b) => a.x - b.x);
          return line.items
            .map((it) => it.str)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        })
        .filter((l) => l.length > 0);

      const pageString = formattedLines.join("\n").trim();
      if (pageString) {
        pageTexts.push(`[Page ${pageNum} of ${numPages}]\n${pageString}`);
      }
    }

    const fullText = pageTexts.join("\n\n").slice(0, 28000);

    // Always render PDF pages (up to 5 pages per PDF) to high-contrast white-background JPEG images
    // so AWS Bedrock Vision models can see all pictures, diagrams, charts, schematics, and scanned content
    if (typeof document !== "undefined") {
      const pagesToRender = Math.min(numPages, 5);
      for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const unscaledViewport = page.getViewport({ scale: 1.0 });
          const maxDim = Math.max(
            unscaledViewport.width,
            unscaledViewport.height,
            1
          );
          // Target ~1200px on the longest edge for crisp OCR & diagram recognition while keeping payload fast
          const targetScale = Math.min(2.0, Math.max(1.2, 1200 / maxDim));
          const viewport = page.getViewport({ scale: targetScale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext("2d");
          if (ctx) {
            // Fill with solid white background first so transparent PDF backgrounds never turn black in JPEG
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({
              canvasContext: ctx,
              viewport,
            }).promise;
            renderedPageImages.push(canvas.toDataURL("image/jpeg", 0.85));
          }
        } catch {
          // Ignore individual page canvas rendering failure
        }
      }
    }

    const wordCount = fullText
      ? fullText.split(/\s+/).filter(Boolean).length
      : 0;

    return {
      pageCount: numPages,
      extractedText: fullText,
      wordCount,
      renderedPageImages,
      pdfJsExtracted: true,
    };
  } catch {
    const fallback = await fallbackExtractFlatePdfText(uint8);
    const wordCount = fallback.extractedText
      ? fallback.extractedText.split(/\s+/).filter(Boolean).length
      : 0;
    return {
      pageCount: fallback.pageCount,
      extractedText: fallback.extractedText,
      wordCount,
      renderedPageImages: [],
      pdfJsExtracted: true,
    };
  }
}
