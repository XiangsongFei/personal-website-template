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

function isRefreshDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  try { return window.sessionStorage.getItem(`${UI_RESTORE_STORAGE_PREFIX}debug-scroll`) === "1"; } catch { return false; }
}

/** Opt-in development-only lifecycle trace. Enable with sessionStorage key `example-cv-cms:ui:debug-scroll=1`. */
export function diagnoseRefreshScroll(stage: string, details: Record<string, unknown>): void {
  if (isRefreshDiagnosticsEnabled()) console.debug("[resume-scroll]", stage, details);
}

export function scrollPositionStorageKey(pathname: string, mode: WorkspaceScrollMode): string {
  return `${UI_RESTORE_STORAGE_PREFIX}scroll:${pathname}:${mode}`;
}

/** Freeze and persist the exact current coordinate for the remainder of this document. Zero is valid. */
export function freezeScrollSnapshot(pathname: string, mode: WorkspaceScrollMode, position: number, reason: string): number | null {
  if (!Number.isFinite(position) || position < 0) return null;
  const key = scrollPositionStorageKey(pathname, mode);
  const alreadyFrozen = frozenScrollSnapshots.has(key);
  const previous = readStoredScrollPosition(pathname, mode);
  if (alreadyFrozen) {
    diagnoseRefreshScroll("snapshot-already-frozen", { pathname, mode, key, previous, position, reason });
    return previous;
  }
  // Freeze before touching storage so callbacks dispatched immediately after this event cannot win.
  frozenScrollSnapshots.add(key);
  try { window.sessionStorage.setItem(key, String(position)); } catch { /* Scroll restoration is optional. */ }
  diagnoseRefreshScroll("snapshot-frozen", { pathname, mode, key, previous, position, reason });
  return position;
}

/** Freeze an already-saved latest user position for non-keyboard reloads; never recalculate at unload. */
export function freezeExistingScrollSnapshot(pathname: string, mode: WorkspaceScrollMode, reason: string): number | null {
  const key = scrollPositionStorageKey(pathname, mode);
  const existing = readStoredScrollPosition(pathname, mode);
  if (existing === null) return null;
  const alreadyFrozen = frozenScrollSnapshots.has(key);
  frozenScrollSnapshots.add(key);
  // Migrate the old editor-only key only by copying its existing value, never by sampling geometry.
  try { window.sessionStorage.setItem(key, String(existing)); } catch { /* Scroll restoration is optional. */ }
  diagnoseRefreshScroll(alreadyFrozen ? "unload-snapshot-preserved" : "unload-snapshot-frozen", { pathname, mode, key, existing, reason });
  return existing;
}

export function isScrollSnapshotFrozen(pathname: string, mode: WorkspaceScrollMode): boolean {
  return frozenScrollSnapshots.has(scrollPositionStorageKey(pathname, mode));
}

/** A bfcache-restored document is active again and may accept new user scrolls. */
export function resumeScrollSnapshotAfterBfcache(pathname: string, mode: WorkspaceScrollMode): void {
  const key = scrollPositionStorageKey(pathname, mode);
  if (!frozenScrollSnapshots.delete(key)) return;
  diagnoseRefreshScroll("snapshot-unfrozen-after-bfcache", { pathname, mode, key });
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
    diagnoseRefreshScroll("write-blocked-frozen", { pathname, mode, key, attemptedPosition: position });
    return;
  }
  try { window.sessionStorage.setItem(key, String(position)); } catch { /* Scroll restoration is optional. */ }
}

/** Persist only scroll changes that follow an actual user input, never bootstrap/programmatic scroll events. */
export function observeUserScroll(
  owner: HTMLElement | Window,
  onUserScroll: (position: number) => void,
  options: { ignoreIntent?: (event: Event) => boolean; onScrollEvent?: (position: number, authorizedByInput: boolean) => void } = {},
): () => void {
  let lastPosition = getPosition(owner);
  let userIntentActive = false;
  let scrollSinceIntent = false;
  let scrollEndObserved = false;
  let pointerActive = false;
  let touchActive = false;
  const pressedScrollKeys = new Set<string>();
  let idleTimer: number | null = null;
  const scrollEndTarget: HTMLElement | Document | Window = typeof window !== "undefined" && owner === window ? document : owner;
  const scrollEndSupported = "onscrollend" in scrollEndTarget;

  const clearIdleTimer = () => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = null;
  };
  const hasActiveGesture = () => pointerActive || touchActive || pressedScrollKeys.size > 0;
  const finishGestureIfIdle = () => {
    if (hasActiveGesture()) return;
    if (!scrollSinceIntent || scrollEndObserved) userIntentActive = false;
    else if (!scrollEndSupported) {
      clearIdleTimer();
      // Older engines without scrollend still need a finite end to the input
      // session. This is only a gesture-idle fallback, never a restore delay.
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
        pressedScrollKeys.clear();
        clearIdleTimer();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"].includes(keyEvent.key)) return;
      pressedScrollKeys.add(keyEvent.key);
    }
    if (event.type === "wheel" && (event as WheelEvent).ctrlKey) return;
    if (event.type === "pointerdown") pointerActive = true;
    if (event.type === "touchstart") touchActive = true;
    if (!userIntentActive) { scrollSinceIntent = false; scrollEndObserved = false; }
    userIntentActive = true;
    clearIdleTimer();
    // A key such as Cmd+R never arms this state. Inputs that do not produce a
    // scroll also cannot leave stale permission for a later layout scroll.
    const positionAtInput = getPosition(owner);
    // Restoration can move the owner without a scroll event being observable
    // by this listener (for example during the first frame after remount).
    // Rebase at each actual gesture so the next user delta, including a move
    // to zero, is compared against the real pre-gesture position.
    lastPosition = positionAtInput;
    queueMicrotask(() => {
      if (!scrollSinceIntent && !hasActiveGesture() && getPosition(owner) === positionAtInput) userIntentActive = false;
    });
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
    scrollSinceIntent = false;
    clearIdleTimer();
  };
  const onScroll = () => {
    const position = getPosition(owner);
    if (position === lastPosition) return;
    lastPosition = position;
    const authorizedByInput = userIntentActive || hasActiveGesture();
    options.onScrollEvent?.(position, authorizedByInput);
    if (!authorizedByInput) return;
    scrollSinceIntent = true;
    onUserScroll(position);
    if (!scrollEndSupported && !hasActiveGesture()) {
      clearIdleTimer();
      idleTimer = window.setTimeout(() => { userIntentActive = false; idleTimer = null; }, 250);
    }
  };
  const intentEvents: Array<keyof WindowEventMap> = ["wheel", "touchstart", "pointerdown", "keydown"];
  for (const eventName of intentEvents) owner.addEventListener(eventName, arm as EventListener, { passive: true, capture: true });
  owner.addEventListener("pointerup", endPointer, true);
  owner.addEventListener("pointercancel", endPointer, true);
  owner.addEventListener("touchend", endTouch, true);
  owner.addEventListener("touchcancel", endTouch, true);
  owner.addEventListener("keyup", endKey, true);
  owner.addEventListener("scroll", onScroll as EventListener, { passive: true });
  scrollEndTarget.addEventListener("scrollend", onScrollEnd as EventListener);
  return () => {
    clearIdleTimer();
    for (const eventName of intentEvents) owner.removeEventListener(eventName, arm as EventListener, true);
    owner.removeEventListener("pointerup", endPointer, true);
    owner.removeEventListener("pointercancel", endPointer, true);
    owner.removeEventListener("touchend", endTouch, true);
    owner.removeEventListener("touchcancel", endTouch, true);
    owner.removeEventListener("keyup", endKey, true);
    owner.removeEventListener("scroll", onScroll as EventListener);
    scrollEndTarget.removeEventListener("scrollend", onScrollEnd as EventListener);
  };
}

function getPosition(owner: HTMLElement | Window): number {
  if (typeof window !== "undefined" && owner === window) {
    const documentOwner = (document.scrollingElement as HTMLElement | null) ?? document.documentElement ?? document.body;
    return Math.max(window.scrollY, documentOwner?.scrollTop ?? 0);
  }
  return (owner as HTMLElement).scrollTop;
}
