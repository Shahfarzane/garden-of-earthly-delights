// How many stroke instances the tile painter may draw in one frame, steered by how long frames
// take. 600k is about one 16.7 ms frame of GPU work on an M3 Pro (docs/plan.md, Round 5), so it is
// the ceiling; a slower GPU gets what it can paint on time.
//
// The signal is the interval between animation frames, all of them, painted or not: when the GPU
// cannot finish a frame's strokes in time, the next frame comes late. Late means past the frame
// loop's own 16.7 ms by half a refresh (on a 120 Hz screen a 16.7 ms interval only skips a frame
// the loop does not paint anyway). A late frame right after painting cuts the budget in proportion;
// a second one within 30 frames, when the frame used much of the budget, also caps regrowth at 90%
// of what it painted. The two frames after a cut cannot cut again, since their lateness may still
// be the GPU finishing frames painted before it. On-time frames that the budget held back grow it
// by 20% and relax the cap by 0.3%, so what was learned holds while nothing needs painting.
// Intervals while nothing is painted measure the display's refresh.
export const BUDGET_MAX = 600_000;
const BUDGET_MIN = 20_000;
const FRAME_MS = 1000 / 60; // the frame loop's period (main.js)

export class FrameBudget {
  max: number;
  value: number; // instances the next frame may paint
  cap: number; // how far `value` may grow back
  vsync: number; // the display's refresh interval, ms
  quiet: number[];
  spent: [number, number];
  last: number;
  late: boolean;
  hold: number;
  frames: number;
  lateAt: number;

  constructor(max = BUDGET_MAX) {
    this.max = max;
    this.value = max;
    this.cap = max;
    this.vsync = FRAME_MS;
    this.quiet = []; // the latest intervals with nothing painted
    this.spent = [0, 0]; // instances painted by the last two frames
    this.last = 0;
    this.late = false;
    this.hold = 0; // frames to wait after a cut, while the GPU drains what came before it
    this.frames = 0;
    this.lateAt = -Infinity; // the frame of the last cut
  }

  // Every animation frame, before anything is drawn.
  tick(now: number): void {
    const dt = now - this.last;
    this.last = now;
    if (!(dt > 0) || dt > 1000 || document.hidden) return; // first frame, or back from a hidden tab
    const recent = Math.max(this.spent[0], this.spent[1]);
    if (!recent) { this.learn(dt); return; }
    if (dt < Math.max(this.vsync, FRAME_MS) + this.vsync * 0.5) return;
    this.late = true;
    if (this.hold) return;
    // a stall of several frames (a shader compile, a busy main thread) says little about the GPU's
    // pace, nor does a late frame that painted a small share of the budget, nor a single late frame
    // among many on time: they cut the budget by at most a half and leave the cap alone
    const stall = dt > FRAME_MS * 4;
    const heavy = recent >= this.value * 0.5;
    const again = this.frames - this.lateAt < 30;
    this.lateAt = this.frames;
    const f = stall ? 0.5 : Math.min(0.8, Math.max(0.25, FRAME_MS / dt));
    this.value = Math.max(BUDGET_MIN, Math.min(this.value, Math.round(Math.max(recent, this.value * 0.5) * f)));
    if (heavy && !stall && again) this.cap = Math.max(BUDGET_MIN, Math.min(this.cap, Math.round(recent * 0.9)));
    this.hold = 2;
  }

  learn(dt: number): void {
    this.quiet.push(dt);
    if (this.quiet.length > 15) this.quiet.shift();
    const s = [...this.quiet].sort((a, b) => a - b);
    this.vsync = s[s.length >> 1];
  }

  // After the painter's frame: what it drew, and whether the budget held work back.
  spend(n: number, limited: boolean): void {
    this.spent[1] = this.spent[0];
    this.spent[0] = n;
    this.frames++;
    if (this.hold) this.hold--;
    if (!this.late && limited) {
      this.cap = Math.min(this.max, this.cap * 1.003);
      // whole instances: a fractional budget would leave a file's next stroke, and with it the
      // vertex attribute offset (start * 12 bytes), between records
      this.value = Math.round(Math.min(this.cap, this.value * 1.2));
    }
    this.late = false;
  }
}
