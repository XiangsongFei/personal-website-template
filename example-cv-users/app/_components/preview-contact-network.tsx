// Static geometry from the public template's contact network in app/page.tsx.
const networkNodes = [
  { id: "n1", x: 24, y: 57, r: 2 },
  { id: "n2", x: 48, y: 135, r: 2.5 },
  { id: "n3", x: 82, y: 79, r: 2 },
  { id: "n4", x: 112, y: 161, r: 2.2 },
  { id: "n5", x: 131, y: 194, r: 1.8 },
  { id: "n6", x: 134, y: 45, r: 2.6 },
  { id: "n7", x: 174, y: 128, r: 2 },
  { id: "n8", x: 191, y: 72, r: 2.2 },
  { id: "n9", x: 231, y: 165, r: 2.5 },
  { id: "n10", x: 243, y: 41, r: 1.8 },
  { id: "n11", x: 298, y: 137, r: 2.2 },
  { id: "n12", x: 295, y: 190, r: 1.8 },
  { id: "n13", x: 314, y: 70, r: 2.4 },
  { id: "n14", x: 367, y: 170, r: 2.2 },
  { id: "n15", x: 372, y: 36, r: 1.8 },
  { id: "r1", x: 92, y: 104, r: 8, ring: true },
  { id: "r2", x: 224, y: 111, r: 10, ring: true },
  { id: "r3", x: 326, y: 88, r: 8.5, ring: true },
];
const networkEdges = [
  ["n1", "n3"],
  ["n1", "n2"],
  ["n2", "n4"],
  ["n2", "r1"],
  ["n3", "n6"],
  ["n3", "n8"],
  ["n3", "r1"],
  ["n4", "n5"],
  ["n4", "n7"],
  ["n4", "r1"],
  ["n5", "n9"],
  ["n6", "n8"],
  ["n6", "n10"],
  ["n7", "n8"],
  ["n7", "n9"],
  ["n7", "r2"],
  ["n8", "n10"],
  ["n8", "r2"],
  ["n9", "n11"],
  ["n9", "n12"],
  ["n9", "r2"],
  ["n10", "n13"],
  ["n11", "n12"],
  ["n11", "n13"],
  ["n11", "n14"],
  ["n12", "n14"],
  ["n13", "n15"],
  ["n13", "r3"],
  ["n14", "r3"],
  ["n15", "r3"],
] as const;
const networkNodeById = new Map(networkNodes.map(node => [node.id, node]));

export function PreviewContactNetwork() {
  return <svg className="public-contact-network" viewBox="0 0 400 220" aria-hidden="true">
    <g opacity=".18">{networkEdges.map(([from, to]) => {
      const a = networkNodeById.get(from)!;
      const b = networkNodeById.get(to)!;
      return <line key={from + '-' + to} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>;
    })}</g>
    {networkNodes.map(({id, x, y, r, ring}) =>
      <circle key={id} cx={x} cy={y} r={r} opacity={ring ? '.32' : '.28'} className={ring ? undefined : 'public-network-dot'}/>)}
  </svg>;
}
