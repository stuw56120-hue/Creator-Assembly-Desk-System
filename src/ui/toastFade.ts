/*
 * Timer machinery for the "Saved" toast's auto-fade behaviour.
 *
 *   show()  ─[5 s]─►  onFadeStart()  ─[400 ms]─►  onRemove()
 *
 * If show() is called again while either timer is pending — e.g. the user
 * triggers a new save while the previous toast is fading — both timers are
 * cleared and the cycle restarts from full opacity. clear() (or destroying
 * the controller) cancels both pending timers, so React unmount doesn't
 * leak a setTimeout firing after the component is gone.
 *
 * Pure (no React), so it's testable with vi.useFakeTimers().
 */

export interface ToastFadeOptions {
  /** Time the toast stays at full opacity before fading. Default 5 000 ms. */
  fadeAfterMs?: number;
  /** Time the CSS opacity transition takes to reach 0. Default 400 ms. */
  fadeDurationMs?: number;
}

export class ToastFadeController {
  private fadeHandle: ReturnType<typeof setTimeout> | null = null;
  private removeHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onFadeStart: () => void,
    private readonly onRemove: () => void,
    private readonly opts: ToastFadeOptions = {},
  ) {}

  /**
   * Start (or restart) the visible → fading → removed cycle.
   * Idempotent w.r.t. calling it during either timer: previous timers are
   * cleared and the toast is shown again from full opacity.
   */
  show(): void {
    this.clear();
    const fadeAfter = this.opts.fadeAfterMs ?? 5000;
    const fadeDur = this.opts.fadeDurationMs ?? 400;
    this.fadeHandle = setTimeout(() => {
      this.fadeHandle = null;
      this.onFadeStart();
      this.removeHandle = setTimeout(() => {
        this.removeHandle = null;
        this.onRemove();
      }, fadeDur);
    }, fadeAfter);
  }

  /** Cancel both pending timers. Safe to call multiple times. */
  clear(): void {
    if (this.fadeHandle != null) {
      clearTimeout(this.fadeHandle);
      this.fadeHandle = null;
    }
    if (this.removeHandle != null) {
      clearTimeout(this.removeHandle);
      this.removeHandle = null;
    }
  }
}
