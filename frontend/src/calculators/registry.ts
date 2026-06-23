// DIY Calculator engine — data-driven. Each calculator defines inputs + a pure compute().
// Pure math, runs client-side & offline. Outputs feed the shopping list (Home Depot / Lowe's qty).

export type CalcInput = {
  key: string;
  label: string;
  unit?: string;
  default?: number;
  step?: number;
  type?: "number" | "select";
  options?: { label: string; value: number }[];
  hint?: string;
};
export type CalcResult = { label: string; value: string | number; unit?: string; primary?: boolean };
export type CalcMaterial = { name: string; qty: number; unit: string };
export type CalcOutput = { results: CalcResult[]; materials: CalcMaterial[]; note?: string };
export type Calculator = {
  id: string;
  name: string;
  category: string;
  icon: string;
  blurb: string;
  inputs: CalcInput[];
  compute: (v: Record<string, number>) => CalcOutput;
};

const ceil = (x: number) => Math.ceil(x - 1e-9);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export const CALC_CATEGORIES = [
  "Painting & Walls", "Flooring & Tile", "Outdoor & Landscape",
  "Concrete & Masonry", "Framing & Carpentry", "Roofing & Gutters", "Other",
];

export const CALCULATORS: Calculator[] = [
  // ---------------- Painting & Walls ----------------
  {
    id: "paint", name: "Paint Calculator", category: "Painting & Walls", icon: "format-paint",
    blurb: "Paint needed for any room by dimensions & coats.",
    inputs: [
      { key: "length", label: "Room length", unit: "ft", default: 12 },
      { key: "width", label: "Room width", unit: "ft", default: 12 },
      { key: "height", label: "Ceiling height", unit: "ft", default: 8 },
      { key: "doors", label: "Doors", unit: "", default: 1 },
      { key: "windows", label: "Windows", unit: "", default: 2 },
      { key: "coats", label: "Coats", unit: "", default: 2 },
    ],
    compute: (v) => {
      const gross = 2 * (v.length + v.width) * v.height;
      const net = Math.max(0, gross - v.doors * 21 - v.windows * 15);
      const gallons = net * v.coats / 350;
      return {
        results: [
          { label: "Paintable wall area", value: Math.round(net), unit: "sq ft" },
          { label: "Paint needed", value: r1(gallons), unit: "gal", primary: true },
        ],
        materials: [
          { name: "Interior paint", qty: ceil(gallons), unit: "gal" },
          { name: "Primer", qty: ceil(net / 350), unit: "gal" },
          { name: 'Roller covers (3/8")', qty: 2, unit: "ea" },
          { name: "Painter's tape", qty: 2, unit: "rolls" },
        ],
        note: "Assumes ~350 sq ft coverage per gallon.",
      };
    },
  },
  {
    id: "wallpaper", name: "Wallpaper Calculator", category: "Painting & Walls", icon: "wallpaper",
    blurb: "Rolls needed factoring pattern repeat.",
    inputs: [
      { key: "length", label: "Room length", unit: "ft", default: 12 },
      { key: "width", label: "Room width", unit: "ft", default: 12 },
      { key: "height", label: "Wall height", unit: "ft", default: 8 },
      { key: "repeat", label: "Pattern repeat", unit: "in", default: 0 },
    ],
    compute: (v) => {
      const area = 2 * (v.length + v.width) * v.height;
      const usable = 56 * (1 - Math.min(0.25, v.repeat / 100)); // double roll ~56 sq ft
      const rolls = ceil((area * 1.15) / usable);
      return {
        results: [
          { label: "Wall area", value: Math.round(area), unit: "sq ft" },
          { label: "Double rolls", value: rolls, unit: "rolls", primary: true },
        ],
        materials: [
          { name: "Wallpaper (double roll)", qty: rolls, unit: "rolls" },
          { name: "Wallpaper paste", qty: ceil(rolls / 4), unit: "gal" },
          { name: "Smoothing tool", qty: 1, unit: "ea" },
        ],
      };
    },
  },
  {
    id: "drywall", name: "Drywall Calculator", category: "Painting & Walls", icon: "wall",
    blurb: "Sheets, screws, compound & tape.",
    inputs: [
      { key: "length", label: "Room length", unit: "ft", default: 12 },
      { key: "width", label: "Room width", unit: "ft", default: 12 },
      { key: "height", label: "Wall height", unit: "ft", default: 8 },
      { key: "ceiling", label: "Include ceiling? (1=yes)", unit: "", default: 1 },
    ],
    compute: (v) => {
      const walls = 2 * (v.length + v.width) * v.height;
      const ceiling = v.ceiling >= 1 ? v.length * v.width : 0;
      const total = walls + ceiling;
      const sheets = ceil(total / 32);
      return {
        results: [
          { label: "Total surface", value: Math.round(total), unit: "sq ft" },
          { label: "Drywall sheets (4×8)", value: sheets, unit: "sheets", primary: true },
        ],
        materials: [
          { name: 'Drywall sheets 4×8', qty: sheets, unit: "sheets" },
          { name: "Drywall screws", qty: sheets * 40, unit: "ea" },
          { name: "Joint compound", qty: ceil(total * 0.053 / 5), unit: "5-gal buckets" },
          { name: "Drywall tape", qty: ceil(total * 0.34 / 250), unit: "rolls" },
        ],
      };
    },
  },
  {
    id: "insulation", name: "Insulation Calculator", category: "Painting & Walls", icon: "home-thermometer-outline",
    blurb: "Batts/rolls for a wall or ceiling area.",
    inputs: [
      { key: "length", label: "Length", unit: "ft", default: 20 },
      { key: "height", label: "Height", unit: "ft", default: 8 },
      { key: "studSpacing", label: "Stud spacing", unit: "in", default: 16, type: "select", options: [{ label: "16 in OC", value: 16 }, { label: "24 in OC", value: 24 }] },
    ],
    compute: (v) => {
      const area = v.length * v.height;
      const battCoverage = v.studSpacing === 24 ? 78.3 : 88.1; // sq ft per bag (R-13)
      const bags = ceil(area / battCoverage);
      return {
        results: [
          { label: "Area", value: Math.round(area), unit: "sq ft" },
          { label: "Insulation bags", value: bags, unit: "bags", primary: true },
        ],
        materials: [
          { name: "Insulation batts/rolls", qty: bags, unit: "bags" },
          { name: "Insulation support wire", qty: 1, unit: "pack" },
        ],
      };
    },
  },
  // ---------------- Flooring & Tile ----------------
  {
    id: "flooring", name: "Flooring Calculator", category: "Flooring & Tile", icon: "view-grid-outline",
    blurb: "Boxes of flooring with waste factor.",
    inputs: [
      { key: "length", label: "Room length", unit: "ft", default: 12 },
      { key: "width", label: "Room width", unit: "ft", default: 12 },
      { key: "waste", label: "Waste", unit: "%", default: 10 },
      { key: "coverage", label: "Sq ft per box", unit: "sq ft", default: 20 },
    ],
    compute: (v) => {
      const area = v.length * v.width;
      const withWaste = area * (1 + v.waste / 100);
      const boxes = ceil(withWaste / v.coverage);
      return {
        results: [
          { label: "Floor area", value: Math.round(area), unit: "sq ft" },
          { label: "With waste", value: Math.round(withWaste), unit: "sq ft" },
          { label: "Boxes needed", value: boxes, unit: "boxes", primary: true },
        ],
        materials: [
          { name: "Flooring", qty: boxes, unit: "boxes" },
          { name: "Underlayment", qty: ceil(area / 100), unit: "rolls" },
          { name: "Transition strips", qty: 2, unit: "ea" },
        ],
      };
    },
  },
  {
    id: "tile", name: "Tile Calculator", category: "Flooring & Tile", icon: "grid",
    blurb: "Tiles, grout & thinset for floors/walls.",
    inputs: [
      { key: "length", label: "Area length", unit: "ft", default: 8 },
      { key: "width", label: "Area width", unit: "ft", default: 6 },
      { key: "tileW", label: "Tile width", unit: "in", default: 12 },
      { key: "tileH", label: "Tile height", unit: "in", default: 12 },
      { key: "waste", label: "Waste", unit: "%", default: 10 },
    ],
    compute: (v) => {
      const area = v.length * v.width;
      const tileSqft = (v.tileW * v.tileH) / 144;
      const tiles = ceil((area * (1 + v.waste / 100)) / tileSqft);
      return {
        results: [
          { label: "Area", value: Math.round(area), unit: "sq ft" },
          { label: "Tiles needed", value: tiles, unit: "tiles", primary: true },
        ],
        materials: [
          { name: "Tiles", qty: tiles, unit: "tiles" },
          { name: "Thinset mortar (50 lb)", qty: ceil(area / 95), unit: "bags" },
          { name: "Grout (25 lb)", qty: ceil(area / 200), unit: "bags" },
          { name: "Tile spacers", qty: 1, unit: "pack" },
        ],
      };
    },
  },
  // ---------------- Outdoor & Landscape ----------------
  {
    id: "deck", name: "Deck Calculator", category: "Outdoor & Landscape", icon: "floor-plan",
    blurb: "Decking boards, joists & screws.",
    inputs: [
      { key: "length", label: "Deck length", unit: "ft", default: 16 },
      { key: "width", label: "Deck width", unit: "ft", default: 12 },
      { key: "boardWidth", label: "Board width", unit: "in", default: 5.5 },
      { key: "joistSpacing", label: "Joist spacing", unit: "in", default: 16, type: "select", options: [{ label: "12 in OC", value: 12 }, { label: "16 in OC", value: 16 }, { label: "24 in OC", value: 24 }] },
    ],
    compute: (v) => {
      const area = v.length * v.width;
      const boardCoverFt = (v.boardWidth + 0.25) / 12;
      const deckLF = ceil((area / boardCoverFt) * 1.1);
      const joists = ceil((v.width * 12) / v.joistSpacing) + 1;
      return {
        results: [
          { label: "Deck area", value: Math.round(area), unit: "sq ft" },
          { label: "Decking (linear ft)", value: deckLF, unit: "ln ft", primary: true },
          { label: "Joists", value: joists, unit: "ea" },
        ],
        materials: [
          { name: "Decking boards", qty: ceil(deckLF / 16), unit: "16-ft boards" },
          { name: "Joists (2×8)", qty: joists, unit: "ea" },
          { name: "Deck screws (5 lb)", qty: ceil(area / 50), unit: "boxes" },
          { name: "Joist hangers", qty: joists * 2, unit: "ea" },
        ],
      };
    },
  },
  {
    id: "fence", name: "Fence Calculator", category: "Outdoor & Landscape", icon: "fence",
    blurb: "Posts, rails, pickets & concrete.",
    inputs: [
      { key: "length", label: "Fence length", unit: "ft", default: 100 },
      { key: "postSpacing", label: "Post spacing", unit: "ft", default: 8 },
      { key: "rails", label: "Rails per section", unit: "", default: 2 },
      { key: "picketWidth", label: "Picket width", unit: "in", default: 5.5 },
      { key: "picketGap", label: "Gap between pickets", unit: "in", default: 0.375 },
    ],
    compute: (v) => {
      const sections = ceil(v.length / v.postSpacing);
      const posts = sections + 1;
      const pickets = ceil((v.length * 12) / (v.picketWidth + v.picketGap));
      return {
        results: [
          { label: "Sections", value: sections, unit: "" },
          { label: "Posts", value: posts, unit: "ea", primary: true },
          { label: "Pickets", value: pickets, unit: "ea" },
        ],
        materials: [
          { name: "Fence posts", qty: posts, unit: "ea" },
          { name: "Rails", qty: sections * v.rails, unit: "ea" },
          { name: "Pickets", qty: pickets, unit: "ea" },
          { name: "Concrete (50 lb)", qty: posts * 2, unit: "bags" },
        ],
      };
    },
  },
  {
    id: "mulch", name: "Mulch & Soil Calculator", category: "Outdoor & Landscape", icon: "shovel",
    blurb: "Cubic yards & bags of mulch/soil.",
    inputs: [
      { key: "length", label: "Bed length", unit: "ft", default: 20 },
      { key: "width", label: "Bed width", unit: "ft", default: 10 },
      { key: "depth", label: "Depth", unit: "in", default: 3 },
    ],
    compute: (v) => {
      const cf = v.length * v.width * (v.depth / 12);
      const cy = cf / 27;
      return {
        results: [
          { label: "Volume", value: r2(cy), unit: "cu yd", primary: true },
          { label: "2 cu ft bags", value: ceil(cf / 2), unit: "bags" },
        ],
        materials: [{ name: "Mulch / soil (2 cu ft)", qty: ceil(cf / 2), unit: "bags" }],
      };
    },
  },
  {
    id: "gravel", name: "Gravel & Stone Calculator", category: "Outdoor & Landscape", icon: "dots-hexagon",
    blurb: "Tons / cubic yards for driveways & paths.",
    inputs: [
      { key: "length", label: "Length", unit: "ft", default: 20 },
      { key: "width", label: "Width", unit: "ft", default: 10 },
      { key: "depth", label: "Depth", unit: "in", default: 4 },
    ],
    compute: (v) => {
      const cf = v.length * v.width * (v.depth / 12);
      const cy = cf / 27;
      return {
        results: [
          { label: "Volume", value: r2(cy), unit: "cu yd", primary: true },
          { label: "Approx weight", value: r1(cy * 1.4), unit: "tons" },
        ],
        materials: [{ name: "Gravel / crushed stone", qty: r1(cy * 1.4), unit: "tons" }],
      };
    },
  },
  {
    id: "grass-seed", name: "Grass Seed Calculator", category: "Outdoor & Landscape", icon: "sprout-outline",
    blurb: "Seed needed for a new or overseeded lawn.",
    inputs: [
      { key: "length", label: "Lawn length", unit: "ft", default: 50 },
      { key: "width", label: "Lawn width", unit: "ft", default: 40 },
      { key: "rate", label: "Rate per 1000 sq ft", unit: "lb", default: 5, type: "select", options: [{ label: "Overseed (3 lb)", value: 3 }, { label: "New lawn (6 lb)", value: 6 }] },
    ],
    compute: (v) => {
      const area = v.length * v.width;
      const lbs = (area / 1000) * v.rate;
      return {
        results: [
          { label: "Lawn area", value: Math.round(area), unit: "sq ft" },
          { label: "Seed needed", value: r1(lbs), unit: "lb", primary: true },
        ],
        materials: [
          { name: "Grass seed", qty: ceil(lbs), unit: "lb" },
          { name: "Starter fertilizer", qty: ceil(area / 5000), unit: "bags" },
        ],
      };
    },
  },
  // ---------------- Concrete & Masonry ----------------
  {
    id: "concrete-slab", name: "Concrete Slab Calculator", category: "Concrete & Masonry", icon: "cube-outline",
    blurb: "Cubic yards & bags for a slab.",
    inputs: [
      { key: "length", label: "Length", unit: "ft", default: 10 },
      { key: "width", label: "Width", unit: "ft", default: 10 },
      { key: "thickness", label: "Thickness", unit: "in", default: 4 },
    ],
    compute: (v) => {
      const cf = v.length * v.width * (v.thickness / 12);
      const cy = cf / 27;
      return {
        results: [
          { label: "Volume", value: r2(cy), unit: "cu yd", primary: true },
          { label: "80 lb bags", value: ceil(cf / 0.6), unit: "bags" },
          { label: "60 lb bags", value: ceil(cf / 0.45), unit: "bags" },
        ],
        materials: [{ name: "Concrete mix (80 lb)", qty: ceil(cf / 0.6), unit: "bags" }],
        note: "Order ready-mix for >1 cu yd. Add 10% for spillage.",
      };
    },
  },
  {
    id: "post-hole", name: "Post Hole Concrete", category: "Concrete & Masonry", icon: "format-vertical-align-bottom",
    blurb: "Concrete bags to set posts.",
    inputs: [
      { key: "holes", label: "Number of holes", unit: "", default: 10 },
      { key: "diameter", label: "Hole diameter", unit: "in", default: 10 },
      { key: "depth", label: "Hole depth", unit: "in", default: 24 },
      { key: "postSize", label: "Post size", unit: "in", default: 3.5 },
    ],
    compute: (v) => {
      const holeCf = Math.PI * Math.pow(v.diameter / 2 / 12, 2) * (v.depth / 12);
      const postCf = Math.pow(v.postSize / 12, 2) * (v.depth / 12);
      const net = Math.max(0, holeCf - postCf) * v.holes;
      return {
        results: [
          { label: "Concrete volume", value: r2(net), unit: "cu ft" },
          { label: "50 lb bags", value: ceil(net / 0.375), unit: "bags", primary: true },
        ],
        materials: [{ name: "Fast-setting concrete (50 lb)", qty: ceil(net / 0.375), unit: "bags" }],
      };
    },
  },
  {
    id: "brick", name: "Brick & Block Calculator", category: "Concrete & Masonry", icon: "wall",
    blurb: "Bricks/blocks & mortar for walls.",
    inputs: [
      { key: "length", label: "Wall length", unit: "ft", default: 20 },
      { key: "height", label: "Wall height", unit: "ft", default: 6 },
      { key: "unit", label: "Unit type", unit: "", default: 7, type: "select", options: [{ label: "Modular brick (7/sq ft)", value: 7 }, { label: "CMU block (1.125/sq ft)", value: 1.125 }] },
    ],
    compute: (v) => {
      const area = v.length * v.height;
      const units = ceil(area * v.unit * 1.05);
      const mortar = v.unit === 7 ? ceil(units / 125) : ceil(units / 33);
      return {
        results: [
          { label: "Wall area", value: Math.round(area), unit: "sq ft" },
          { label: "Units needed", value: units, unit: "ea", primary: true },
        ],
        materials: [
          { name: v.unit === 7 ? "Bricks" : "CMU blocks", qty: units, unit: "ea" },
          { name: "Mortar mix (80 lb)", qty: mortar, unit: "bags" },
        ],
      };
    },
  },
  // ---------------- Framing & Carpentry ----------------
  {
    id: "framing", name: "Wall Framing Calculator", category: "Framing & Carpentry", icon: "fence",
    blurb: "Studs & plates for a stud wall.",
    inputs: [
      { key: "length", label: "Wall length", unit: "ft", default: 20 },
      { key: "spacing", label: "Stud spacing", unit: "in", default: 16, type: "select", options: [{ label: "16 in OC", value: 16 }, { label: "24 in OC", value: 24 }] },
    ],
    compute: (v) => {
      const studs = ceil((v.length * 12) / v.spacing) + 1 + 2; // +corners/extra
      const plateLF = ceil(v.length * 3 * 1.1); // top double + bottom
      return {
        results: [
          { label: "Studs", value: studs, unit: "ea", primary: true },
          { label: "Plate lumber", value: plateLF, unit: "ln ft" },
        ],
        materials: [
          { name: "2×4 studs (8 ft)", qty: studs, unit: "ea" },
          { name: "2×4 plates (8 ft)", qty: ceil(plateLF / 8), unit: "ea" },
          { name: "Framing nails (5 lb)", qty: 1, unit: "box" },
        ],
      };
    },
  },
  {
    id: "stairs", name: "Stair Calculator", category: "Framing & Carpentry", icon: "stairs",
    blurb: "Rise, run & stringers for stairs.",
    inputs: [
      { key: "totalRise", label: "Total rise (floor to floor)", unit: "in", default: 108 },
      { key: "treadRun", label: "Tread run", unit: "in", default: 10 },
    ],
    compute: (v) => {
      const steps = Math.max(1, Math.round(v.totalRise / 7.5));
      const riser = v.totalRise / steps;
      const treads = steps - 1;
      const runTotal = treads * v.treadRun;
      const stringer = Math.sqrt(runTotal * runTotal + v.totalRise * v.totalRise) / 12;
      return {
        results: [
          { label: "Number of steps", value: steps, unit: "", primary: true },
          { label: "Riser height", value: r2(riser), unit: "in" },
          { label: "Total run", value: r1(runTotal / 12), unit: "ft" },
          { label: "Stringer length", value: r1(stringer), unit: "ft" },
        ],
        materials: [
          { name: "Stringers (2×12)", qty: 3, unit: "ea" },
          { name: "Treads", qty: treads, unit: "ea" },
          { name: "Risers", qty: steps, unit: "ea" },
        ],
        note: "Aim for 7–7.75 in risers and 10–11 in treads (code).",
      };
    },
  },
  {
    id: "trim", name: "Trim & Baseboard Calculator", category: "Framing & Carpentry", icon: "border-bottom-variant",
    blurb: "Baseboard / trim linear footage.",
    inputs: [
      { key: "length", label: "Room length", unit: "ft", default: 12 },
      { key: "width", label: "Room width", unit: "ft", default: 12 },
      { key: "doors", label: "Door openings", unit: "", default: 1 },
    ],
    compute: (v) => {
      const perimeter = Math.max(0, 2 * (v.length + v.width) - v.doors * 3);
      const withWaste = perimeter * 1.1;
      return {
        results: [
          { label: "Perimeter", value: Math.round(perimeter), unit: "ln ft" },
          { label: "Trim (with waste)", value: Math.round(withWaste), unit: "ln ft", primary: true },
        ],
        materials: [
          { name: "Baseboard (16-ft)", qty: ceil(withWaste / 16), unit: "ea" },
          { name: "Finish nails", qty: 1, unit: "pack" },
          { name: "Caulk", qty: 2, unit: "tubes" },
        ],
      };
    },
  },
  {
    id: "crown-molding", name: "Crown Molding Calculator", category: "Framing & Carpentry", icon: "vector-line",
    blurb: "Linear feet of crown molding.",
    inputs: [
      { key: "length", label: "Room length", unit: "ft", default: 12 },
      { key: "width", label: "Room width", unit: "ft", default: 12 },
    ],
    compute: (v) => {
      const perimeter = 2 * (v.length + v.width);
      const withWaste = perimeter * 1.15;
      return {
        results: [
          { label: "Perimeter", value: Math.round(perimeter), unit: "ln ft" },
          { label: "Molding (with waste)", value: Math.round(withWaste), unit: "ln ft", primary: true },
        ],
        materials: [{ name: "Crown molding (16-ft)", qty: ceil(withWaste / 16), unit: "ea" }],
      };
    },
  },
  // ---------------- Roofing & Gutters ----------------
  {
    id: "roofing", name: "Roofing Calculator", category: "Roofing & Gutters", icon: "home-roof",
    blurb: "Shingle bundles & underlayment.",
    inputs: [
      { key: "length", label: "Footprint length", unit: "ft", default: 40 },
      { key: "width", label: "Footprint width", unit: "ft", default: 30 },
      { key: "pitch", label: "Roof pitch", unit: "", default: 1.118, type: "select", options: [
        { label: "4/12 (low)", value: 1.054 }, { label: "6/12", value: 1.118 }, { label: "8/12", value: 1.202 }, { label: "12/12 (steep)", value: 1.414 },
      ] },
    ],
    compute: (v) => {
      const roofArea = v.length * v.width * v.pitch;
      const squares = roofArea / 100;
      const bundles = ceil(squares * 3 * 1.1);
      return {
        results: [
          { label: "Roof area", value: Math.round(roofArea), unit: "sq ft" },
          { label: "Squares", value: r1(squares), unit: "sq" },
          { label: "Shingle bundles", value: bundles, unit: "bundles", primary: true },
        ],
        materials: [
          { name: "Shingle bundles", qty: bundles, unit: "bundles" },
          { name: "Underlayment", qty: ceil(squares / 2), unit: "rolls" },
          { name: "Roofing nails (5 lb)", qty: ceil(squares / 3), unit: "boxes" },
          { name: "Drip edge (10-ft)", qty: ceil((2 * (v.length + v.width)) / 10), unit: "ea" },
        ],
      };
    },
  },
  {
    id: "gutter", name: "Gutter Calculator", category: "Roofing & Gutters", icon: "water-outline",
    blurb: "Gutters, downspouts & hangers.",
    inputs: [
      { key: "eaveLength", label: "Total eave length", unit: "ft", default: 120 },
      { key: "stories", label: "Stories", unit: "", default: 1 },
    ],
    compute: (v) => {
      const sections = ceil(v.eaveLength / 10);
      const downspouts = ceil(v.eaveLength / 35);
      return {
        results: [
          { label: "Gutter length", value: Math.round(v.eaveLength), unit: "ft" },
          { label: "Gutter sections (10-ft)", value: sections, unit: "ea", primary: true },
          { label: "Downspouts", value: downspouts, unit: "ea" },
        ],
        materials: [
          { name: "Gutter sections (10-ft)", qty: sections, unit: "ea" },
          { name: "Downspouts", qty: downspouts, unit: "ea" },
          { name: "Hangers", qty: ceil(v.eaveLength / 2), unit: "ea" },
          { name: "End caps & corners", qty: 4, unit: "ea" },
        ],
      };
    },
  },
  // ---------------- Other ----------------
  {
    id: "pool-volume", name: "Pool Volume & Chemicals", category: "Other", icon: "pool",
    blurb: "Gallons & startup chemical doses.",
    inputs: [
      { key: "length", label: "Length", unit: "ft", default: 24 },
      { key: "width", label: "Width", unit: "ft", default: 12 },
      { key: "avgDepth", label: "Average depth", unit: "ft", default: 5 },
    ],
    compute: (v) => {
      const gallons = v.length * v.width * v.avgDepth * 7.48;
      return {
        results: [
          { label: "Pool volume", value: Math.round(gallons).toLocaleString(), unit: "gal", primary: true },
          { label: "Shock (per 10k gal)", value: ceil(gallons / 10000), unit: "lb" },
        ],
        materials: [
          { name: "Chlorine shock", qty: ceil(gallons / 10000), unit: "lb" },
          { name: "Stabilizer (cyanuric acid)", qty: ceil(gallons / 30000), unit: "lb" },
        ],
      };
    },
  },
  {
    id: "cabinet-hardware", name: "Cabinet Hardware Calculator", category: "Other", icon: "fridge-outline",
    blurb: "Knobs & pulls for a kitchen.",
    inputs: [
      { key: "doors", label: "Cabinet doors", unit: "", default: 20 },
      { key: "drawers", label: "Drawers", unit: "", default: 8 },
    ],
    compute: (v) => {
      return {
        results: [
          { label: "Knobs (doors)", value: v.doors, unit: "ea", primary: true },
          { label: "Pulls (drawers)", value: v.drawers, unit: "ea" },
          { label: "Total hardware", value: v.doors + v.drawers, unit: "ea" },
        ],
        materials: [
          { name: "Cabinet knobs", qty: v.doors, unit: "ea" },
          { name: "Drawer pulls", qty: v.drawers, unit: "ea" },
          { name: "Hardware jig", qty: 1, unit: "ea" },
        ],
      };
    },
  },
  {
    id: "tool-roi", name: "Tool Rental vs Buy", category: "Other", icon: "tools",
    blurb: "Break-even on renting vs buying.",
    inputs: [
      { key: "rentPerDay", label: "Rental per day", unit: "$", default: 45 },
      { key: "days", label: "Days you need it", unit: "", default: 3 },
      { key: "buyPrice", label: "Purchase price", unit: "$", default: 220 },
    ],
    compute: (v) => {
      const rentTotal = v.rentPerDay * v.days;
      const breakeven = v.rentPerDay > 0 ? r1(v.buyPrice / v.rentPerDay) : 0;
      const rec = rentTotal < v.buyPrice ? "Rent it" : "Buy it";
      return {
        results: [
          { label: "Total rental cost", value: `$${Math.round(rentTotal)}`, unit: "" },
          { label: "Break-even", value: breakeven, unit: "days" },
          { label: "Recommendation", value: rec, unit: "", primary: true },
        ],
        materials: [],
        note: "Buying wins if you'll use it longer than the break-even days.",
      };
    },
  },
];

export const getCalculator = (id?: string) => CALCULATORS.find((c) => c.id === id);

// Map project/guide keywords -> calculator id for contextual popups & AI triggers.
const PROJECT_CALC_MAP: { keywords: string[]; calc: string }[] = [
  { keywords: ["paint", "repaint", "wall color"], calc: "paint" },
  { keywords: ["wallpaper"], calc: "wallpaper" },
  { keywords: ["drywall", "sheetrock", "patch wall"], calc: "drywall" },
  { keywords: ["insulat"], calc: "insulation" },
  { keywords: ["floor", "laminate", "vinyl plank", "hardwood"], calc: "flooring" },
  { keywords: ["tile", "backsplash", "grout"], calc: "tile" },
  { keywords: ["deck"], calc: "deck" },
  { keywords: ["fence"], calc: "fence" },
  { keywords: ["mulch", "soil", "garden bed"], calc: "mulch" },
  { keywords: ["gravel", "driveway", "stone path"], calc: "gravel" },
  { keywords: ["lawn", "grass", "seed", "overseed"], calc: "grass-seed" },
  { keywords: ["concrete", "slab", "patio pour"], calc: "concrete-slab" },
  { keywords: ["post hole", "set post"], calc: "post-hole" },
  { keywords: ["brick", "block", "masonry", "cmu"], calc: "brick" },
  { keywords: ["fram", "stud wall"], calc: "framing" },
  { keywords: ["stair"], calc: "stairs" },
  { keywords: ["baseboard", "trim"], calc: "trim" },
  { keywords: ["crown molding"], calc: "crown-molding" },
  { keywords: ["roof", "shingle"], calc: "roofing" },
  { keywords: ["gutter", "downspout"], calc: "gutter" },
  { keywords: ["pool"], calc: "pool-volume" },
  { keywords: ["cabinet hardware", "cabinet knob", "cabinet pull", "drawer pull"], calc: "cabinet-hardware" },
];

export function calculatorForProject(title?: string): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const m of PROJECT_CALC_MAP) {
    if (m.keywords.some((k) => t.includes(k))) return m.calc;
  }
  return null;
}
