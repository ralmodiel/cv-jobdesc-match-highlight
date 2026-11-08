// Input checks at the trust boundary: what a file really is (by its bytes, not its name) and how big it may get.
export const LIMITS = { bytes: 15 * 1024 * 1024, zipEntries: 2000, unzipped: 60 * 1024 * 1024, pages: 40, jobChars: 40000, imagePx: 50e6 }; // imagePx: a 50 MP phone photo fits

export const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** 'pdf' | 'zip' | 'ole' | 'rtf' | null, from the first bytes. */
export function sniff(buf) {
  const b = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) return "zip";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "ole";
  const head = String.fromCharCode(...b);
  if (head.startsWith("{\\rtf")) return "rtf";
  if (head.includes("%PDF-")) return "pdf"; // the spec lets junk precede the header within the first 1 KB
  return null;
}

export class InputError extends Error {}

/** Reject files we cannot or should not open, with a message a person can act on. */
export function checkFile(file, buf) {
  if (file.size > LIMITS.bytes) throw new InputError(`That file is ${(file.size / 1048576).toFixed(1)} MB. CVs over 15 MB are not supported; try exporting it again with smaller images.`);
  if (!buf.byteLength) throw new InputError("That file is empty.");
  const kind = sniff(buf);
  if (kind === "pdf") return "pdf";
  if (kind === "zip") return "docx"; // confirmed when the package is opened
  if (kind === "ole") throw new InputError("This looks like an older Word .doc file or a password-protected document. In Word, use File → Save As → Word Document (.docx), then add that file. If it is password-protected, remove the password first (File → Info → Protect Document).");
  if (kind === "rtf") throw new InputError("This is an RTF file. Save it as Word Document (.docx) or PDF, then add it again.");
  throw new InputError("This file is not a PDF or a Word (.docx) document.");
}

/** Zip-bomb guard for DOCX packages. The sizes a zip declares can lie, so each part is also unpacked once, counting, and the
 *  file is refused at the first part that gives more (or less) than it said: at most 60 MB plus one 16 KB block's worth. */
export async function checkZip(zip) {
  const files = Object.values(zip.files);
  if (files.length > LIMITS.zipEntries) throw new InputError("This Word file has an unusual structure (too many parts) and was not opened.");
  let total = 0;
  for (const f of files) total += f._data?.uncompressedSize || 0;
  if (total > LIMITS.unzipped) throw new InputError("This Word file expands to more than 60 MB and was not opened.");
  for (const f of files) {
    await new Promise((ok, no) => {
      let n = 0;
      const s = f.internalStream("uint8array").on("error", no).on("end", ok)
        .on("data", (c) => { if ((n += c.length) > (f._data?.uncompressedSize || 0)) { s.pause(); no(); } });
      s.resume();
    }).catch(() => { throw new InputError("This Word file is damaged and was not opened. If it opens in Word, save it again as .docx and add that copy."); });
  }
}

export const baseName = (name) => (name || "cv").replace(/\.(pdf|docx?)$/i, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "cv";

/** Hand a Blob to the user as a download. The object URL never leaves this tab. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
