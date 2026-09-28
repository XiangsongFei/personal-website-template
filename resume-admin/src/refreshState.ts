export function isDocumentReloadNavigation(): boolean {
  if (typeof window === "undefined" || typeof window.performance?.getEntriesByType !== "function") return false;
  try {
    return window.performance.getEntriesByType("navigation")
      .some(entry => (entry as PerformanceNavigationTiming).type === "reload");
  } catch {
    return false;
  }
}

export type WorkspaceScrollMode = "editor" | "preview";

const UI_RESTORE_STORAGE_PREFIX = "example-cv-cms:ui:";
const frozenScrollSnapshots = new Set<string>();

export function scrollPositionStorageKey(pathname: string, mode: WorkspaceScrollMode): string {
  return `${UI_RESTORE_STORAGE_PREFIX}scroll:${pathname}:${mode}`;
}

/** Return null instead of treating a Safari negative rubber-band position as a real top coordinate. */
export function readDocumentScrollPosition(): number | null {
  const { position, negativeOverscroll } = getScrollPosition(window);
  return negativeOverscroll ? null : position;
}

/** Freeze and persist the exact current coordinate for the remainder of this document. Zero is valid. */
export function freezeScrollSnapshot(pathname: string, mode: WorkspaceScrollMode, position: number): number | null {
  if (!Number.isFinite(position) || position < 0) return null;
  const key = scrollPositionStorageKey(pathname, mode);
  const alreadyFrozen = frozenScrollSnapshots.has(key);
  const previous = readStoredScrollPosition(pathname, mode);
  if (alreadyFrozen) {
    return previous;
  }
  // Freeze before touching storage so callbacks dispatched immediately after this event cannot win.
  frozenScrollSnapshots.add(key);
  try { window.sessionStorage.setItem(key, String(position)); } catch { /* Scroll restoration is optional. */ }
  return position;
}

/** Freeze an already-saved latest user position for non-keyboard reloads; never recalculate at unload. */
export function freezeExistingScrollSnapshot(pathname: string, mode: WorkspaceScrollMode): number | null {
  const key = scrollPositionStorageKey(pathname, mode);
  const existing = readStoredScrollPosition(pathname, mode);
  if (existing === null) return null;
  frozenScrollSnapshots.add(key);
  // Migrate the old editor-only key only by copying its existing value, never by sampling geometry.
  try { window.sessionStorage.setItem(key, String(existing)); } catch { /* Scroll restoration is optional. */ }
  return existing;
}

export function isScrollSnapshotFrozen(pathname: string, mode: WorkspaceScrollMode): boolean {
  return frozenScrollSnapshots.has(scrollPositionStorageKey(pathname, mode));
}

/** A bfcache-restored document is active again and may accept new user scrolls. */
export function resumeScrollSnapshotAfterBfcache(pathname: string, mode: WorkspaceScrollMode): void {
  frozenScrollSnapshots.delete(scrollPositionStorageKey(pathname, mode));
}

/** Simulates a fresh browser document in tests; real reloads reset this module state naturally. */
export function resetScrollSnapshotFreezesForTests(): void {
  frozenScrollSnapshots.clear();
}

/** Read the route+mode key; the former route-only key remains an editor fallback. */
export function readStoredScrollPosition(pathname: string, mode: WorkspaceScrollMode): number | null {
  try {
    const value = window.sessionStorage.getItem(scrollPositionStorageKey(pathname, mode))
      ?? (mode === "editor" ? window.sessionStorage.getItem(`${UI_RESTORE_STORAGE_PREFIX}scroll:${pathname}`) : null);
    if (value === null) return null;
    const position = Number(value);
    return Number.isFinite(position) && position >= 0 ? position : null;
  } catch {
    return null;
  }
}

export function writeStoredScrollPosition(pathname: string, mode: WorkspaceScrollMode, position: number): void {
  if (!Number.isFinite(position) || position < 0) return;
  const key = scrollPositionStorageKey(pathname, mode);
  if (frozenScrollSnapshots.has(key)) {
    return;
  }
  try { window.sessionStorage.setItem(key, String(position)); } catch { /* Scroll restoration is optional. */ }
}

/** Persist only scroll changes that follow an actual user input, never bootstrap/programmatic scroll events. */
export function observeUserScroll(
  owner: HTMLElement | Window,
  onUserScroll: (position: number) => void,
  options: { ignoreIntent?: (event: Event) => boolean } = {},
): () => void {
  let lastPosition = getPosition(owner);
  let userIntentActive = false;
  let scrollSinceIntent = false;
  let scrollEndObserved = false;
  let intentInvalidatedByOverscroll = false;
  let pointerActive = false;
  let touchActive = false;
  let wheelIntentActive = false;
  let wheelIntentTimer: number | null = null;
  const pressedScrollKeys = new Set<string>();
  let idleTimer: number | null = null;
  const scrollEndTarget: HTMLElement | Document | Window = typeof window !== "undefined" && owner === window ? document : owner;

  const clearIdleTimer = () => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = null;
  };
  const clearWheelIntentTimer = () => {
    if (wheelIntentTimer !== null) window.clearTimeout(wheelIntentTimer);
    wheelIntentTimer = null;
  };
  const renewWheelIntent = () => {
    wheelIntentActive = true;
    clearWheelIntentTimer();
    wheelIntentTimer = window.setTimeout(() => {
      wheelIntentActive = false;
      wheelIntentTimer = null;
      if (!hasActiveGesture()) {
        userIntentActive = false;
        scrollSinceIntent = false;
      }
    }, 250);
  };
  const hasActiveGesture = () => pointerActive || touchActive || pressedScrollKeys.size > 0;
  const finishGestureIfIdle = () => {
    if (hasActiveGesture()) return;
    if (wheelIntentActive) return;
    if (!scrollSinceIntent || scrollEndObserved) userIntentActive = false;
    else {
      clearIdleTimer();
      // Gesture authorization must expire from user input/gesture end. Scroll
      // events themselves must not extend it over later layout or rubber-band
      // events. scrollend can revoke it sooner when the browser provides it.
      idleTimer = window.setTimeout(() => { userIntentActive = false; idleTimer = null; }, 250);
    }
  };
  const arm = (event: Event) => {
    if (options.ignoreIntent?.(event)) return;
    if (event.type === "keydown") {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.metaKey || keyEvent.ctrlKey || keyEvent.altKey || keyEvent.key === "F5" || keyEvent.key === "BrowserRefresh") {
        // Browser shortcuts (notably Cmd/Ctrl+R) terminate the current input
        // session so their incidental reset-to-top cannot inherit an earlier
        // wheel/scroll gesture's permission to persist.
        userIntentActive = false;
        scrollSinceIntent = false;
        scrollEndObserved = false;
        pointerActive = false;
        touchActive = false;
        wheelIntentActive = false;
        pressedScrollKeys.clear();
        clearIdleTimer();
        clearWheelIntentTimer();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"].includes(keyEvent.key)) return;
      pressedScrollKeys.add(keyEvent.key);
    }
    if (event.type === "wheel" && (event as WheelEvent).ctrlKey) return;
    if (event.type === "wheel") {
      renewWheelIntent();
      if (!hasActiveGesture()) {
        userIntentActive = false;
        scrollSinceIntent = false;
        scrollEndObserved = false;
      }
    }
    if (event.type === "pointerdown") pointerActive = true;
    if (event.type === "touchstart") touchActive = true;
    if (!userIntentActive && !wheelIntentActive) { scrollSinceIntent = false; scrollEndObserved = false; }
    // A fresh user input starts a new authorization window after any prior
    // Safari rubber-band overscroll sequence.
    intentInvalidatedByOverscroll = false;
    if (event.type !== "wheel") userIntentActive = true;
    clearIdleTimer();
    // A key such as Cmd+R never arms this state. Inputs that do not produce a
    // scroll also cannot leave stale permission for a later layout scroll.
    const positionAtInput = getPosition(owner);
    // Restoration can move the owner without a scroll event being observable
    // by this listener (for example during the first frame after remount).
    // Rebase at each actual gesture so the next user delta, including a move
    // to zero, is compared against the real pre-gesture position.
    lastPosition = positionAtInput;
    // Wheel scrolling may be applied by the browser after this event's
    // microtask checkpoint. Keep that intent alive through the resulting
    // asynchronous scroll event instead of clearing it on an unchanged read.
    if (event.type !== "wheel") {
      queueMicrotask(() => {
        if (!scrollSinceIntent && !hasActiveGesture() && !wheelIntentActive && getPosition(owner) === positionAtInput) userIntentActive = false;
      });
    }
  };
  const endPointer = () => { pointerActive = false; finishGestureIfIdle(); };
  const endTouch = () => { touchActive = false; finishGestureIfIdle(); };
  const endKey = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    pressedScrollKeys.delete(keyEvent.key);
    finishGestureIfIdle();
  };
  const onScrollEnd = () => {
    scrollEndObserved = true;
    if (hasActiveGesture()) return;
    userIntentActive = false;
    wheelIntentActive = false;
    scrollSinceIntent = false;
    clearIdleTimer();
    clearWheelIntentTimer();
  };
  const onScroll = () => {
    const { position, negativeOverscroll } = getScrollPosition(owner);
    if (negativeOverscroll) intentInvalidatedByOverscroll = true;
    if (position === lastPosition) return;
    lastPosition = position;
    const authorizedByInput = !intentInvalidatedByOverscroll && (userIntentActive || wheelIntentActive || hasActiveGesture());
    if (authorizedByInput) {
      scrollSinceIntent = true;
      onUserScroll(position);
    }
    // A wheel event authorizes the scroll response to that input once. Do not
    // let its timer authorize later unrelated scrolls; subsequent trackpad or
    // wheel movement has its own wheel event and arms a new one-shot intent.
    if (wheelIntentActive) {
      wheelIntentActive = false;
      clearWheelIntentTimer();
      if (!hasActiveGesture()) {
        userIntentActive = false;
        scrollSinceIntent = false;
      }
    }
  };
  const intentEvents: Array<keyof WindowEventMap> = ["wheel", "touchstart", "pointerdown", "keydown"];
  for (const eventName of intentEvents) owner.addEventListener(eventName, arm as EventListener, { passive: true, capture: true });
  owner.addEventListener("pointerup", endPointer, true);
  owner.addEventListener("pointercancel", endPointer, true);
  owner.addEventListener("touchend", endTouch, true);
  owner.addEventListener("touchcancel", endTouch, true);
  owner.addEventListener("keyup", endKey, true);
  // Viewport scroll events can be dispatched on Document/the root scrolling
  // element without bubbling to Window (notably in Safari). Observe that path
  // in capture phase as well; lastPosition de-duplicates any Window event.
  if (typeof window !== "undefined" && owner === window) {
    document.addEventListener("scroll", onScroll as EventListener, { passive: true, capture: true });
  }
  owner.addEventListener("scroll", onScroll as EventListener, { passive: true });
  scrollEndTarget.addEventListener("scrollend", onScrollEnd as EventListener);
  return () => {
    clearIdleTimer();
    clearWheelIntentTimer();
    for (const eventName of intentEvents) owner.removeEventListener(eventName, arm as EventListener, true);
    owner.removeEventListener("pointerup", endPointer, true);
    owner.removeEventListener("pointercancel", endPointer, true);
    owner.removeEventListener("touchend", endTouch, true);
    owner.removeEventListener("touchcancel", endTouch, true);
    owner.removeEventListener("keyup", endKey, true);
    owner.removeEventListener("scroll", onScroll as EventListener);
    if (typeof window !== "undefined" && owner === window) document.removeEventListener("scroll", onScroll as EventListener, true);
    scrollEndTarget.removeEventListener("scrollend", onScrollEnd as EventListener);
  };
}

function getPosition(owner: HTMLElement | Window): number {
  return getScrollPosition(owner).position;
}

function getScrollPosition(owner: HTMLElement | Window): { position: number; negativeOverscroll: boolean } {
  if (typeof window !== "undefined" && owner === window) {
    const documentOwner = (document.scrollingElement as HTMLElement | null) ?? document.documentElement ?? document.body;
    const candidates = [window.scrollY, documentOwner?.scrollTop ?? 0];
    const maximum = Math.max(...candidates);
    return {
      position: Math.max(0, maximum),
      // Safari may report the root position below zero while bouncing at the
      // top. Treat a negative-only viewport state as overscroll, not a real 0.
      negativeOverscroll: maximum <= 0 && candidates.some(value => value < 0),
    };
  }
  const rawPosition = (owner as HTMLElement).scrollTop;
  return { position: Math.max(0, rawPosition), negativeOverscroll: rawPosition < 0 };
}
