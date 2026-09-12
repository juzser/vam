// Decode QR symbols with macOS's own Vision framework -- the oracle for
// `src/renderer/settings/qr.ts`.
//
// A unit test can prove the finder patterns are where ISO 18004 puts them. It
// cannot prove a CAMERA reads the symbol, and every interesting way to get a
// QR encoder wrong (a capacity table off by one, the format bits' BCH, the
// mask written into the format area not matching the mask applied, a block
// interleave in the wrong order) produces a matrix that LOOKS like a QR code
// and decodes to nothing.
//
// Vision is the same class of detector a phone camera runs, and it ships with
// the OS -- no dependency enters the repo for this.
//
// Usage, from `e2e/qr-decode-check.mjs`:
//   swift e2e/qr-decode.swift <png> [<png> ...]
// Prints one line per file: `<path>\t<payload>` or `<path>\tNONE`.

import AppKit
import Foundation
import Vision

var failed = false
for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let cg = bitmap.cgImage
    else {
        print("\(path)\tUNREADABLE")
        failed = true
        continue
    }
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    do {
        try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    } catch {
        print("\(path)\tERROR \(error)")
        failed = true
        continue
    }
    let results = request.results ?? []
    if results.isEmpty {
        print("\(path)\tNONE")
        failed = true
        continue
    }
    for result in results {
        print("\(path)\t\(result.payloadStringValue ?? "(no payload)")")
    }
}
exit(failed ? 1 : 0)
