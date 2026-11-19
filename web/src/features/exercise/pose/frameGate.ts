/**
 * One frame in detection at a time. A frame that arrives while another is being detected is dropped, never queued,
 * like CameraX's keep-only-latest strategy on Android, so the skeleton never falls behind the body.
 */
export class LatestFrameGate {
  private open = true
  dropped = 0

  tryEnter(): boolean {
    if (!this.open) { this.dropped++; return false }
    this.open = false
    return true
  }

  leave() { this.open = true }
}
