/**
 * The model person's body as points for a curve to pass through (android GuideOutline.kt). It is the person from the
 * sign-in page, so the front view repeats the outlines in web/src/auth/FormFigure.tsx, and the side view keeps the
 * same proportions. Parts hanging from a joint start at that joint, with +y down the bone and +x forward (or outward
 * in the front view). Side-view shoes are the exception: +y runs toward the toe and +x runs up.
 */
export interface Offset { x: number; y: number }

const points = (...values: number[]): Offset[] => Array.from({ length: values.length / 2 }, (_, i) => ({ x: values[i * 2]!, y: values[i * 2 + 1]! }))
/** Mirrors the right half of a shape across the centre line. Points on the centre line are not repeated. */
const both = (half: Offset[]) => [...half, ...[...half].reverse().filter((p) => p.x !== 0).map((p) => ({ x: -p.x, y: p.y }))]
const oval = (x: number, y: number, width: number, height: number) => Array.from({ length: 12 }, (_, i) => ({ x: x + width * Math.cos((i * Math.PI) / 6), y: y + height * Math.sin((i * Math.PI) / 6) }))

/** How long each bone is in these units. The rig's own length then stretches the part to fit. */
export const LENGTH = { upperArm: 106, forearm: 88, hand: 44, thigh: 142, shank: 139, foot: 67 } as const
/** Where the shoulder sits on the sign-in figure, which the front torso hangs from. */
export const SHOULDER_Y = 176

export const OUTLINE = {
  UpperArm: points(-14, -13, 0, -19, 14, -13, 18, 12, 17, 48, 14, 82, 13, 108, -12, 108, -14, 82, -15, 44, -15, 10),
  Sleeve: points(-15, -14, 0, -20, 15, -14, 19, 12, 18, 42, -15, 46, -16, 10),
  Forearm: points(-13, -6, -16, 22, -12, 56, -8, 90, 8, 90, 11, 56, 17, 24, 13, -6),
  Hand: points(-8, -3, -10, 14, -9, 28, -5, 40, 1, 44, 7, 39, 10, 26, 9, 10, 8, -3),
  Thumb: points(-8, 6, -15, 15, -15, 26, -10, 24, -7, 17),
  Face: both(points(0, -40, 19, -37, 30, -21, 32, 1, 27, 19, 15, 34, 0, 40)),
  Hair: points(-33, 3, -36, -23, -27, -43, -8, -52, 14, -52, 31, -41, 37, -21, 34, 3, 29, -11, 24, -23, 8, -26, -10, -23, -24, -21, -29, -9),
  LeftEar: oval(-32, 3, 4.5, 8),
  RightEar: oval(32, 3, 4.5, 8),
  LeftEye: oval(-12.5, 0, 2.6, 3.2),
  RightEye: oval(12.5, 0, 2.6, 3.2),
  Neck: both(points(14, 108, 15, 138, 30, 152, 12, 170, 0, 174)),
  Shirt: both(points(0, 170, 15, 162, 25, 147, 48, 153, 67, 168, 66, 205, 60, 236, 53, 264, 55, 288, 0, 294)),
  Shorts: both(points(0, 282, 53, 278, 66, 305, 73, 345, 75, 392, 44, 398, 12, 392, 3, 358, 0, 352)),
  Thigh: points(-19, -20, 0, -30, 30, -20, 34, 10, 35, 50, 29, 98, 22, 140, 19, 156, 8, 166, -8, 160, -13, 140, -10, 98, -20, 50, -20, 10),
  Shank: points(-13, -12, 0, -18, 19, -12, 20, 26, 20, 66, 12, 116, 9, 142, -9, 142, -13, 116, -19, 66, -18, 26),
  Shoe: points(-10, -43, 10, -43, 18, -27, 23, -15, 15, -5, -9, -5, -19, -13, -15, -29),
  Sole: points(-18, -12, -9, -7, 15, -7, 23, -13, 23, -5, 15, 0, -9, 0, -19, -5),
  ProfileHand: points(-9, -3, -11, 12, -11, 27, -8, 38, -1, 44, 6, 42, 10, 32, 11, 16, 9, -3),
  ProfileHead: points(-2, -40, 16, -37, 28, -24, 31, -9, 29, -2, 33, 6, 38, 13, 33, 18, 32, 22, 29, 25, 31, 29, 27, 33, 27, 40, 15, 44, -2, 40, -14, 28, -30, 14, -37, -6, -30, -28, -16, -38),
  ProfileEar: points(-13, -8, -6, -9, -4, 0, -7, 9, -11, 12, -14, 3),
  ProfileHair: points(25, -25, 22, -40, 8, -50, -12, -51, -30, -43, -40, -24, -42, -4, -37, 10, -29, 16, -23, 10, -18, 0, -16, -9, -7, -12, -3, 6, 1, -8, 9, -19, 17, -23),
  ProfileEye: oval(19, -1, 2.4, 3.2),
  ProfileNeck: points(20, -40, 20, -8, 24, 12, -22, 12, -20, -8, -16, -44),
  ProfileTorso: points(17, -12, 33, 8, 41, 34, 39, 66, 35, 100, 34, 135, 38, 170, 0, 176, -39, 171, -33, 130, -38, 84, -43, 40, -38, 6, -20, -13),
  ProfilePelvis: points(33, -26, 37, 0, 31, 22, 0, 33, -27, 29, -41, 8, -36, -26),
  ProfileThigh: points(-30, 0, -34, 35, -30, 80, -22, 118, -20, 142, -10, 160, 10, 162, 22, 150, 23, 138, 26, 110, 31, 70, 32, 30, 28, 0, 0, -16),
  ProfileShank: points(-20, -6, -28, 30, -30, 55, -22, 90, -13, 125, -12, 145, 12, 145, 13, 120, 18, 80, 21, 40, 23, 10, 19, -8, 0, -14),
  ProfileShorts: points(-33, -5, -37, 35, -37, 78, -36, 87, -29, 90, 28, 90, 35, 87, 36, 78, 35, 30, 31, -5, 0, -18),
  ProfileShoe: points(17, -17, 0, -24, -16, -23, -18, 10, -18, 58, -13, 71, -3, 67, 3, 50, 11, 32, 23, 17, 20, 0),
  ProfileSole: points(-15, -23, -16, 10, -16, 60, -15, 69, -19, 71, -24, 60, -24, -17, -20, -24),
}
export const PROFILE_FINGERS: [Offset, Offset][] = [[{ x: -4, y: 25 }, { x: -4, y: 40 }], [{ x: 1, y: 26 }, { x: 1, y: 42 }], [{ x: 6, y: 25 }, { x: 6, y: 39 }]]
/** The lowest points under the heel and the toe, which must not pass through the floor. */
export const HEEL: Offset = { x: -24, y: -17 }
export const TOE: Offset = { x: -24, y: 60 }
