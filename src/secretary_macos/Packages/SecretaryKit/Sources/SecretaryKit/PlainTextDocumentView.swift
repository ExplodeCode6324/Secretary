import AppKit

/// Large bodies use TextKit 2 viewport layout in a bounded scroll view, never Markdown or a giant SwiftUI Text.
@MainActor
public final class PlainTextDocumentView: NSScrollView {
  public let textView = NSTextView(usingTextLayoutManager: true)
  public init() {
    super.init(frame: NSRect(x: 0, y: 0, width: 400, height: 240))
    textView.frame = bounds
    textView.isEditable = false
    textView.isSelectable = true
    textView.isRichText = false
    textView.font = .systemFont(ofSize: 13)
    textView.textContainerInset = NSSize(width: 8, height: 8)
    textView.isVerticallyResizable = true
    textView.isHorizontallyResizable = false
    textView.autoresizingMask = [.width]
    textView.textContainer?.widthTracksTextView = true
    textView.setAccessibilityLabel("长正文（纯文本，可滚动）")
    documentView = textView
    hasVerticalScroller = true
  }
  public required init?(coder: NSCoder) { fatalError("Use init()") }
  public func setText(_ text: String) {
    if textView.string != text { textView.string = text }
  }
}
