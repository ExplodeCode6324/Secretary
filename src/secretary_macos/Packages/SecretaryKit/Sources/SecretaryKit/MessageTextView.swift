import AppKit

/// Native IME composition remains owned by NSTextView; Command-Return never submits marked text.
@MainActor
public final class MessageTextView: NSTextView {
  public var onSend: (() -> Void)?
  public override func keyDown(with event: NSEvent) {
    if event.keyCode == 36
      && event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command
    {
      if !hasMarkedText() { onSend?() }
      return
    }
    super.keyDown(with: event)
  }
}
