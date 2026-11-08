// Download controls, in the preview header so the result and the button sit together.
import { Icon, Seg, Spinner } from "./ui.jsx";

const NAME = { pdf: "PDF", docx: "Word" };

export default function Download({ kind, format, onFormat, out, saving, saved, onDownload }) {
  const rebuilt = kind && format !== kind;
  return (
    <>
      {/* one row on phones too, where the button names no format (the switch beside it shows it; screen readers still hear it) so a wide
          fallback font (DejaVu Sans) still fits at 360 px; below about 320 px the two halves wrap, each full width */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <div className="min-w-28 flex-1 sm:w-40 sm:flex-none"><Seg legend="Download as" hideLegend value={format} onChange={onFormat} options={[["pdf", "PDF"], ["docx", "Word"]]} disabled={!kind} /></div>
        <button type="button" className="btn btn-primary min-w-max flex-1 sm:flex-none" onClick={onDownload} disabled={!out || saving}>
          {saving ? <Spinner /> : <Icon name="download" className="size-4" />}Download{kind && <span className="max-sm:sr-only"> {NAME[format]}</span>}
        </button>
      </div>
      {/* the browser's own download notice is easy to miss and often silent to screen readers; the region stays put so it is announced */}
      <p role="status" className={saved ? "basis-full text-sm text-ok wrap-anywhere" : "sr-only"}>
        {saved && <><Icon name="check" className="mr-1 inline size-4 align-[-3px]" />Downloaded <span className="font-medium">{saved}</span></>}
      </p>
      {(rebuilt || out?.fallback > 0) && (
        <p className="basis-full text-sm text-ink-3">
          <Icon name="info" className="mr-1 inline size-4 align-[-3px]" />
          {rebuilt ? `Your CV is a ${NAME[kind]} file, so the ${NAME[format]} version is rebuilt in a clean one-column layout. Choose ${NAME[kind]} to keep your own design.`
            : `${out.fallback} letters have no bold version in this PDF's fonts, so they are underlined instead. The Word download has true bold.`}
        </p>
      )}
    </>
  );
}
