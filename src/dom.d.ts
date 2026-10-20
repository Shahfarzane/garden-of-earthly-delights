// Browser features TypeScript's DOM library leaves out.

interface Navigator {
  // Device Memory API (Chromium): RAM in GiB, rounded
  readonly deviceMemory?: number;
}

interface WheelEvent {
  // non-standard, in Chromium and WebKit: +-120 per mouse wheel notch
  readonly wheelDeltaY?: number;
}

// Safari's trackpad pinch
interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface WindowEventMap {
  gesturestart: GestureEvent;
  gesturechange: GestureEvent;
  gestureend: GestureEvent;
}
