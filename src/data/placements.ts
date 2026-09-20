export type View = "front" | "back";

export type SourceSize = { width: number; height: number };

export type Spot = {
  id: string;
  name: string;
  category: string;
  price: number;
  currentBid: number;
  description: string;
  view: View;
  /** Source-image pixels — edit these four numbers to move or resize a placement. */
  position: { x: number; y: number; width: number; height: number };
};

export const modelSources: Record<View, SourceSize> = {
  front: { width: 440, height: 1398 },
  back: { width: 558, height: 1314 },
};

// HOW TO EDIT A SPOT
// x: moves right (+) / left (-)    y: moves down (+) / up (-)
// width: makes the slot wider      height: makes the slot taller
// Values use the original PNG pixels above; they scale automatically on every screen.
export const frontPlacements: Spot[] = [
  { id: "front-chest", name: "Chest Spot", category: "Premium placement", price: 1200, currentBid: 1200, description: "Hero-sized placement across the chest.", view: "front", position: { x: 97, y: 300, width: 246, height: 145 } },

  { id: "front-stomach", name: "Stomach Spot", category: "Hero placement", price: 1100, currentBid: 1100, description: "Centered placement made for the camera.", view: "front", position: { x: 105, y: 505, width: 244, height: 109 } },
  { id: "front-shorts", name: "Shorts Spot", category: "Standard placement", price: 700, currentBid: 700, description: "A generous, central placement on the shorts.", view: "front", position: { x: 110, y: 672, width: 246, height: 100 } },
  { id: "front-left-leg", name: "Left Leg Spot", category: "Standard placement", price: 500, currentBid: 500, description: "A distinct left-leg placement for full-length shots.", view: "front", position: { x: 140, y: 924, width: 78, height: 100 } },
  { id: "front-right-leg", name: "Right Leg Spot", category: "Standard placement", price: 500, currentBid: 500, description: "A distinct right-leg placement for full-length shots.", view: "front", position: { x: 315, y: 924, width: 78, height: 100 } },
];

export const backPlacements: Spot[] = [
  { id: "back-head", name: "Head Spot", category: "Low key placement", price: 350, currentBid: 350, description: "A playful little placement right above the boot.", view: "back", position: { x: 260, y: 39, width: 99, height: 100 } },
  { id: "back-mega", name: "Back Mega", category: "Hero placement", price: 1300, currentBid: 1300, description: "The biggest mark, high on the back.", view: "back", position: { x: 205, y: 205, width: 250, height: 150 } },
  { id: "back-upper", name: "Upper Back Spot", category: "Premium placement", price: 900, currentBid: 900, description: "A sharp placement just below the shoulders.", view: "back", position: { x: 210, y: 381, width: 249, height: 100 } },
  { id: "back-mid-left", name: "Mid Back Left Spot", category: "Premium placement", price: 800, currentBid: 800, description: "A central, easy-to-see back placement.", view: "back", position: { x: 233, y: 486, width: 102, height: 132 } },
  { id: "back-mid-right", name: "Mid Back Right Spot", category: "Premium placement", price: 800, currentBid: 800, description: "A central, easy-to-see back placement.", view: "back", position: { x: 353, y: 486, width: 102, height: 132 } },
  { id: "back-shorts", name: "Back Shorts Spot", category: "Standard placement", price: 650, currentBid: 650, description: "A centered logo moment on the shorts.", view: "back", position: { x: 209, y: 634, width: 279, height: 132 } },
  { id: "back-left-leg", name: "Back Left Leg", category: "Standard placement", price: 500, currentBid: 500, description: "A left-leg spot for full-length content.", view: "back", position: { x: 230, y: 907, width: 80, height: 100 } },
  { id: "back-right-leg", name: "Back Right Leg", category: "Standard placement", price: 500, currentBid: 500, description: "A right-leg spot for full-length content.", view: "back", position: { x: 400, y: 907, width: 80, height: 100 } },
];

export const spots = [...frontPlacements, ...backPlacements];
