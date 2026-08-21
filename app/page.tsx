"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Locale = "zh" | "en";
type ScrollSnapshot = { sectionId: string; progress: number; hash: string; previousScrollBehavior: string };
type SavedScrollSnapshot = { scrollY: number; hash: string; bufferHeight: number; bufferMarginBottom: string; isContactBufferActive: boolean; wasDividerAligned: boolean };
type Project = [title: string, subtitle: string, period: string, methods: string[], description: string, href: string];

const protectedChineseIntroTerms = new Set(["管理信息系统", "本科生", "双学位"]);

function renderIntroParagraph(paragraph: string, locale: Locale) {
  if (locale !== "zh") return paragraph;
  return paragraph.split(/(管理信息系统|本科生|双学位)/g).map((part, index) =>
    protectedChineseIntroTerms.has(part)
      ? <span className="intro-keep-term" key={`${part}-${index}`}>{part}</span>
      : part
  );
}

const preferredLanguageStorageKey = "preferredLanguage";
const scrollPositionStorageKey = "resumeScrollPosition";
const reloadScrollYStorageKey = "resume-scroll-y";
const reloadScrollPathStorageKey = "resume-scroll-path";
const reloadContactBufferStorageKey = "resume-contact-buffer";
const scrollSectionIds = ["about", "education", "experience", "projects", "skills", "awards", "contact"];
const dividerAlignedSectionIds = new Set(["experience", "projects", "skills", "awards"]);

function MailIcon() {
  return <svg className="link-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>;
}

function FileTextIcon() {
  return <svg className="link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></svg>;
}

function LinkedInIcon() {
  return <svg className="link-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r=".8"/><path d="M8 11v6M12 17v-3.8c0-1.4.9-2.3 2.1-2.3s2.1.9 2.1 2.3V17M12 11v6"/></svg>;
}

function GitHubIcon() {
  return <svg className="link-icon github-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4a9.6 9.6 0 0 0-3.03 18.71c.48.09.66-.21.66-.47v-1.68c-2.68.58-3.24-1.13-3.24-1.13-.44-1.12-1.07-1.42-1.07-1.42-.87-.6.07-.59.07-.59.97.07 1.48 1 1.48 1 .86 1.48 2.25 1.05 2.8.8.09-.63.34-1.05.62-1.29-2.14-.24-4.39-1.07-4.39-4.76 0-1.05.38-1.91.99-2.58-.1-.24-.43-1.22.1-2.54 0 0 .81-.26 2.64.98A9.15 9.15 0 0 1 12 6.6c.82 0 1.64.11 2.41.33 1.83-1.24 2.64-.98 2.64-.98.53 1.32.2 2.3.1 2.54.62.67.99 1.53.99 2.58 0 3.7-2.25 4.51-4.4 4.75.35.3.65.86.65 1.74v2.58c0 .26.17.56.66.47A9.6 9.6 0 0 0 12 2.4Z"/></svg>;
}

function ExternalLinkIcon() {
  return <svg className="external-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>;
}

function ContactStatusIcon({ type }: { type: string }) {
  if (type === "study") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-4 9 4-9 4-9-4Zm3.5 2.2V15c0 1.6 2.5 2.9 5.5 2.9s5.5-1.3 5.5-2.9v-3.8M21 9v6"/></svg>;
  if (type === "graduation") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="m17 7 3-3M18 4h2v2"/></svg>;
}

const networkNodes = [
  { id: "n1", x: 24, y: 57, r: 2 }, { id: "n2", x: 48, y: 135, r: 2.5 }, { id: "n3", x: 82, y: 79, r: 2 }, { id: "n4", x: 112, y: 161, r: 2.2 }, { id: "n5", x: 131, y: 194, r: 1.8 }, { id: "n6", x: 134, y: 45, r: 2.6 }, { id: "n7", x: 174, y: 128, r: 2 }, { id: "n8", x: 191, y: 72, r: 2.2 }, { id: "n9", x: 231, y: 165, r: 2.5 }, { id: "n10", x: 243, y: 41, r: 1.8 }, { id: "n11", x: 298, y: 137, r: 2.2 }, { id: "n12", x: 295, y: 190, r: 1.8 }, { id: "n13", x: 314, y: 70, r: 2.4 }, { id: "n14", x: 367, y: 170, r: 2.2 }, { id: "n15", x: 372, y: 36, r: 1.8 },
  { id: "r1", x: 92, y: 104, r: 8, ring: true }, { id: "r2", x: 224, y: 111, r: 10, ring: true }, { id: "r3", x: 326, y: 88, r: 8.5, ring: true },
];
const networkEdges = [["n1", "n3"], ["n1", "n2"], ["n2", "n4"], ["n2", "r1"], ["n3", "n6"], ["n3", "n8"], ["n3", "r1"], ["n4", "n5"], ["n4", "n7"], ["n4", "r1"], ["n5", "n9"], ["n6", "n8"], ["n6", "n10"], ["n7", "n8"], ["n7", "n9"], ["n7", "r2"], ["n8", "n10"], ["n8", "r2"], ["n9", "n11"], ["n9", "n12"], ["n9", "r2"], ["n10", "n13"], ["n11", "n12"], ["n11", "n13"], ["n11", "n14"], ["n12", "n14"], ["n13", "n15"], ["n13", "r3"], ["n14", "r3"], ["n15", "r3"]] as const;
const networkNodeById = new Map(networkNodes.map(node => [node.id, node]));
const networkEdgesByNode = new Map<string, (typeof networkEdges)[number][]>();
networkNodes.forEach(node => networkEdgesByNode.set(node.id, []));
networkEdges.forEach(edge => {
  networkEdgesByNode.get(edge[0])?.push(edge);
  networkEdgesByNode.get(edge[1])?.push(edge);
});
const networkEdgeId = (from: string, to: string) => from < to ? `${from}|${to}` : `${to}|${from}`;
const networkPrimaryNodeIds = new Set(["r1", "r2", "r3"]);
const networkOrbitals = [{ id: "r1", r: 17, duration: 18000 }, { id: "r3", r: 18, duration: -22000 }] as const;
const networkPulses = [
  { id: "pulse-1", currentNode: "n1", nextNode: "n3", progress: 0.36, durationMin: 2000, durationMax: 3000 },
  { id: "pulse-2", currentNode: "n7", nextNode: "r2", progress: 0.58, durationMin: 2600, durationMax: 3800 },
  { id: "pulse-3", currentNode: "n13", nextNode: "r3", progress: 0.24, durationMin: 3200, durationMax: 4500 },
] as const;
const networkPulsePaths: Record<string, readonly string[]> = {
  "pulse-1": ["n1", "n3", "r1", "n2"],
  "pulse-2": ["n7", "r2", "n8"],
  "pulse-3": ["n13", "r3", "n14", "n11"],
};
type NetworkVisual = { x: number; y: number; strength: number };
type ActivationWave = { x: number; y: number; startedAt: number };
type RoutedPulse = { currentNode: string; nextNode: string; previousNode: string | null; progress: number; speed: number; duration: number; startedAt: number; pauseUntil: number; edgeId: string | null; phase: number };
type EdgeHighlight = { level: number; lastUpdated: number };

function DataNetworkGraphic() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const nodeCircleRefs = useRef(new Map<string, SVGCircleElement>());
  const edgeRefs = useRef(new Map<string, SVGLineElement>());
  const pulseRefs = useRef(new Map<string, SVGCircleElement>());
  const orbitalRefs = useRef(new Map<string, SVGCircleElement>());
  const haloRefs = useRef(new Map<string, SVGCircleElement>());
  const rippleRef = useRef<SVGCircleElement | null>(null);
  const ambientFrameRef = useRef<number | null>(null);
  const rippleFrameRef = useRef<number | null>(null);
  const activationFrameRef = useRef<number | null>(null);
  const returnFrameRef = useRef<number | null>(null);
  const dragRenderFrameRef = useRef<number | null>(null);
  const pendingDragPointRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const stopWindowDragTrackingRef = useRef<(() => void) | null>(null);
  const resumeAmbientRef = useRef<() => void>(() => {});
  const activeNodeRef = useRef<string | null>(null);
  const activationNodeIdsRef = useRef(new Set<string>());
  const activationDelaysRef = useRef(new Map<string, number>());
  const activationWaveRef = useRef<ActivationWave | null>(null);
  const visibleRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const nodePositionsRef = useRef(new Map(networkNodes.map(node => [node.id, { x: node.x, y: node.y }])));
  const visualsRef = useRef(new Map<string, NetworkVisual>(networkNodes.map(node => [node.id, { x: 0, y: 0, strength: 0 }])));
  const pulseRouteRef = useRef<RoutedPulse[]>([]);
  const activeEdgeCountRef = useRef(new Map<string, number>());
  const edgeHighlightRef = useRef(new Map<string, EdgeHighlight>());

  const activationStrengthFor = (node: (typeof networkNodes)[number], now: number) => {
    const wave = activationWaveRef.current;
    if (!wave || !activationNodeIdsRef.current.has(node.id)) return 0;
    const delay = activationDelaysRef.current.get(node.id) ?? 0;
    const progress = (now - wave.startedAt - delay) / 260;
    return progress <= 0 || progress >= 1 ? 0 : Math.sin(Math.PI * progress) * 0.2;
  };

  const randomPulseValue = (min: number, max: number) => min + Math.random() * (max - min);

  const updateActiveEdgeCount = (edgeId: string, change: number) => {
    const nextCount = Math.max(0, (activeEdgeCountRef.current.get(edgeId) ?? 0) + change);
    if (nextCount === 0) activeEdgeCountRef.current.delete(edgeId);
    else activeEdgeCountRef.current.set(edgeId, nextCount);
  };

  const chooseNextPulseNode = (pulseIndex: number, pulse: RoutedPulse) => {
    const definition = networkPulses[pulseIndex];
    const path = definition ? networkPulsePaths[definition.id] : undefined;
    if (!path || path.length === 0) return pulse.currentNode;
    const currentIndex = path.indexOf(pulse.currentNode);
    return path[(currentIndex + 1 + path.length) % path.length] ?? pulse.currentNode;
  };

  const beginPulseEdge = (pulseIndex: number, nextNode: string, now: number, initialProgress = 0) => {
    const pulse = pulseRouteRef.current[pulseIndex];
    const definition = networkPulses[pulseIndex];
    if (!pulse || !definition) return;
    const fromPosition = nodePositionsRef.current.get(pulse.currentNode) ?? networkNodeById.get(pulse.currentNode);
    const toPosition = nodePositionsRef.current.get(nextNode) ?? networkNodeById.get(nextNode);
    if (!fromPosition || !toPosition) return;
    const length = Math.hypot(toPosition.x - fromPosition.x, toPosition.y - fromPosition.y);
    const baseDuration = randomPulseValue(definition.durationMin, definition.durationMax);
    pulse.duration = baseDuration * Math.max(1, Math.min(1.35, length / 70));
    pulse.speed = 1 / pulse.duration;
    pulse.nextNode = nextNode;
    pulse.progress = initialProgress;
    pulse.startedAt = now - pulse.duration * initialProgress;
    pulse.pauseUntil = 0;
    pulse.edgeId = networkEdgeId(pulse.currentNode, nextNode);
    updateActiveEdgeCount(pulse.edgeId, 1);
  };

  const ensureRoutedPulses = (now: number) => {
    if (pulseRouteRef.current.length === networkPulses.length) return;
    activeEdgeCountRef.current.clear();
    edgeHighlightRef.current.clear();
    pulseRouteRef.current = networkPulses.map(pulse => ({
      currentNode: pulse.currentNode,
      nextNode: pulse.nextNode,
      previousNode: null,
      progress: pulse.progress,
      duration: pulse.durationMin,
      speed: 1 / pulse.durationMin,
      startedAt: now,
      pauseUntil: 0,
      edgeId: null,
      phase: Math.random() * Math.PI * 2,
    }));
    pulseRouteRef.current.forEach((pulse, index) => beginPulseEdge(index, pulse.nextNode, now, pulse.progress));
  };

  const renderVisuals = (visuals: Map<string, NetworkVisual>, now = 0, animateAmbient = !reducedMotionRef.current) => {
    networkNodes.forEach(node => {
      const visual = visuals.get(node.id) ?? { x: 0, y: 0, strength: 0 };
      const position = nodePositionsRef.current.get(node.id) ?? node;
      const group = nodeRefs.current.get(node.id);
      const circle = nodeCircleRefs.current.get(node.id);
      if (!group || !circle) return;
      const breath = networkPrimaryNodeIds.has(node.id) && animateAmbient ? (Math.sin(now / 2400 + (node.id === "r1" ? 0 : node.id === "r2" ? 1.8 : 3.7)) + 1) / 2 : 0;
      const baseOpacity = networkPrimaryNodeIds.has(node.id) ? (animateAmbient ? 0.32 + breath * 0.13 : 0.32) : 0.28;
      const activationStrength = activationStrengthFor(node, now);
      const interactionRadiusScale = visual.strength * 0.2;
      const ambientRadiusScale = visual.strength > 0 ? 0 : breath * 0.12;
      group.setAttribute("transform", `translate(${position.x - node.x + visual.x} ${position.y - node.y + visual.y})`);
      group.setAttribute("opacity", `${Math.min(0.68, baseOpacity + visual.strength * (0.64 - baseOpacity) + activationStrength)}`);
      circle.setAttribute("r", `${node.r * (1 + interactionRadiusScale + ambientRadiusScale + activationStrength * 0.15)}`);
    });
    const activeNodeId = activeNodeRef.current;
    networkEdges.forEach(([from, to]) => {
      const line = edgeRefs.current.get(`${from}-${to}`);
      const edgeId = networkEdgeId(from, to);
      const fromVisual = visuals.get(from) ?? { x: 0, y: 0, strength: 0 };
      const toVisual = visuals.get(to) ?? { x: 0, y: 0, strength: 0 };
      const fromNode = networkNodeById.get(from);
      const toNode = networkNodeById.get(to);
      if (!line || !fromNode || !toNode) return;
      const fromPosition = nodePositionsRef.current.get(from) ?? fromNode;
      const toPosition = nodePositionsRef.current.get(to) ?? toNode;
      line.setAttribute("x1", `${fromPosition.x + fromVisual.x}`);
      line.setAttribute("y1", `${fromPosition.y + fromVisual.y}`);
      line.setAttribute("x2", `${toPosition.x + toVisual.x}`);
      line.setAttribute("y2", `${toPosition.y + toVisual.y}`);
      const activationStrength = Math.max(activationStrengthFor(fromNode, now), activationStrengthFor(toNode, now));
      const connectedToActive = activeNodeId === from || activeNodeId === to;
      const baseOpacity = 0.18 + Math.max(fromVisual.strength, toVisual.strength) * 0.18;
      const lineOpacity = activeNodeId ? (connectedToActive ? Math.max(baseOpacity, 0.33 + Math.max(fromVisual.strength, toVisual.strength) * 0.09) : baseOpacity * 0.72) : baseOpacity;
      const targetHighlight = (activeEdgeCountRef.current.get(edgeId) ?? 0) > 0 && animateAmbient ? 1 : 0;
      const highlight = edgeHighlightRef.current.get(edgeId) ?? { level: 0, lastUpdated: now };
      const elapsed = Math.max(0, now - highlight.lastUpdated);
      const duration = targetHighlight > highlight.level ? 240 : 420;
      highlight.level += (targetHighlight - highlight.level) * Math.min(1, elapsed / duration);
      highlight.lastUpdated = now;
      edgeHighlightRef.current.set(edgeId, highlight);
      const particleOpacity = highlight.level * 0.14;
      const particleStroke = Math.round(111 - highlight.level * 19);
      line.setAttribute("opacity", `${Math.min(0.52, lineOpacity + activationStrength + particleOpacity)}`);
      line.style.stroke = `rgb(${particleStroke}, ${particleStroke}, ${particleStroke})`;
      line.style.strokeWidth = `${connectedToActive ? (dragRef.current ? 1.18 : 1) : activationStrength > 0 ? 1 : 0.9}`;
    });
    networkPrimaryNodeIds.forEach(id => {
      const node = networkNodeById.get(id);
      const visual = visuals.get(id) ?? { x: 0, y: 0, strength: 0 };
      const halo = haloRefs.current.get(id);
      if (!node || !halo) return;
      const position = nodePositionsRef.current.get(id) ?? node;
      halo.removeAttribute("transform");
      halo.setAttribute("cx", `${position.x + visual.x}`);
      halo.setAttribute("cy", `${position.y + visual.y}`);
      halo.setAttribute("r", `${node.r * 2.35}`);
      halo.setAttribute("opacity", `${node.id === activeNodeRef.current ? visual.strength * 0.16 : 0}`);
    });
    networkOrbitals.forEach(orbital => {
      const node = networkNodeById.get(orbital.id);
      const visual = visuals.get(orbital.id) ?? { x: 0, y: 0, strength: 0 };
      const circle = orbitalRefs.current.get(orbital.id);
      if (!node || !circle) return;
      const position = nodePositionsRef.current.get(orbital.id) ?? node;
      const x = position.x + visual.x;
      const y = position.y + visual.y;
      circle.setAttribute("cx", `${x}`);
      circle.setAttribute("cy", `${y}`);
      circle.setAttribute("transform", animateAmbient ? `rotate(${(now / orbital.duration) * 360} ${x} ${y})` : "");
    });
    if (animateAmbient) ensureRoutedPulses(now);
    networkPulses.forEach((pulse, index) => {
      const circle = pulseRefs.current.get(pulse.id);
      if (!circle) return;
      const route = pulseRouteRef.current[index];
      const currentPosition = nodePositionsRef.current.get(route?.currentNode ?? pulse.currentNode) ?? networkNodeById.get(route?.currentNode ?? pulse.currentNode);
      const nextPosition = nodePositionsRef.current.get(route?.nextNode ?? pulse.nextNode) ?? networkNodeById.get(route?.nextNode ?? pulse.nextNode);
      if (!currentPosition || !nextPosition) return;
      if (!animateAmbient) {
        circle.setAttribute("cx", `${currentPosition.x + (nextPosition.x - currentPosition.x) * pulse.progress}`);
        circle.setAttribute("cy", `${currentPosition.y + (nextPosition.y - currentPosition.y) * pulse.progress}`);
        circle.setAttribute("opacity", "0.3");
        return;
      }
      if (!route) return;
      if (route.pauseUntil > now) {
        circle.setAttribute("cx", `${currentPosition.x}`);
        circle.setAttribute("cy", `${currentPosition.y}`);
        circle.setAttribute("opacity", `${0.3 + 0.1 * Math.sin(now / 1200 + route.phase)}`);
        return;
      }
      if (!route.edgeId) beginPulseEdge(index, chooseNextPulseNode(index, route), now);
      const fromPosition = nodePositionsRef.current.get(route.currentNode) ?? networkNodeById.get(route.currentNode);
      const toPosition = nodePositionsRef.current.get(route.nextNode) ?? networkNodeById.get(route.nextNode);
      if (!fromPosition || !toPosition) return;
      route.progress = Math.min(1, Math.max(0, (now - route.startedAt) * route.speed));
      circle.setAttribute("cx", `${fromPosition.x + (toPosition.x - fromPosition.x) * route.progress}`);
      circle.setAttribute("cy", `${fromPosition.y + (toPosition.y - fromPosition.y) * route.progress}`);
      circle.setAttribute("opacity", `${0.3 + 0.1 * Math.sin(now / 1200 + route.phase)}`);
      if (route.progress >= 1) {
        if (route.edgeId) updateActiveEdgeCount(route.edgeId, -1);
        route.previousNode = route.currentNode;
        route.currentNode = route.nextNode;
        route.edgeId = null;
        route.pauseUntil = now + randomPulseValue(100, 400);
      }
    });
  };

  const renderDraggedNode = (nodeId: string, x: number, y: number) => {
    const node = networkNodeById.get(nodeId);
    const group = nodeRefs.current.get(nodeId);
    const circle = nodeCircleRefs.current.get(nodeId);
    if (!node || !group || !circle) return;

    nodePositionsRef.current.set(nodeId, { x, y });
    group.setAttribute("transform", `translate(${x - node.x} ${y - node.y})`);
    group.setAttribute("opacity", "0.68");
    circle.setAttribute("r", `${node.r * 1.2}`);

    (networkEdgesByNode.get(nodeId) ?? []).forEach(([from, to]) => {
      const line = edgeRefs.current.get(`${from}-${to}`);
      const fromNode = networkNodeById.get(from);
      const toNode = networkNodeById.get(to);
      if (!line || !fromNode || !toNode) return;
      const fromPosition = nodePositionsRef.current.get(from) ?? fromNode;
      const toPosition = nodePositionsRef.current.get(to) ?? toNode;
      line.setAttribute("x1", `${fromPosition.x}`);
      line.setAttribute("y1", `${fromPosition.y}`);
      line.setAttribute("x2", `${toPosition.x}`);
      line.setAttribute("y2", `${toPosition.y}`);
      line.setAttribute("opacity", "0.42");
      line.style.strokeWidth = "1.18";
    });

    const halo = haloRefs.current.get(nodeId);
    if (halo) {
      halo.setAttribute("transform", `translate(${x - node.x} ${y - node.y})`);
      halo.setAttribute("opacity", "0.16");
    }

    networkOrbitals.filter(orbital => orbital.id === nodeId).forEach(orbital => {
      orbitalRefs.current.get(orbital.id)?.setAttribute("transform", `translate(${x - node.x} ${y - node.y})`);
    });
  };

  const scheduleDraggedNodeRender = (pointerId: number, clientX: number, clientY: number) => {
    pendingDragPointRef.current = { pointerId, clientX, clientY };
    if (dragRenderFrameRef.current !== null) return;
    dragRenderFrameRef.current = requestAnimationFrame(() => {
      dragRenderFrameRef.current = null;
      const pending = pendingDragPointRef.current;
      const drag = dragRef.current;
      if (!pending || !drag || drag.pointerId !== pending.pointerId) return;
      const point = toSvgPoint(pending.clientX, pending.clientY);
      if (!point) return;
      renderDraggedNode(drag.id, Math.max(16, Math.min(384, point.x)), Math.max(16, Math.min(204, point.y)));
    });
  };

  const toSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    try {
      return point.matrixTransform(matrix.inverse());
    } catch {
      return null;
    }
  };

  const createVisuals = (activeNodeId: string | null, strength = 0) => new Map<string, NetworkVisual>(networkNodes.map(node => [node.id, { x: 0, y: 0, strength: node.id === activeNodeId ? strength : 0 }]));

  const renderHover = (nodeId: string | null, now = performance.now()) => {
    activeNodeRef.current = nodeId;
    const visuals = createVisuals(nodeId, nodeId ? 0.6 : 0);
    visualsRef.current = visuals;
    renderVisuals(visuals, now);
  };

  const startBackgroundActivation = (point: { x: number; y: number }) => {
    const ripple = rippleRef.current;
    if (!ripple) return;
    if (rippleFrameRef.current !== null) cancelAnimationFrame(rippleFrameRef.current);
    ripple.setAttribute("cx", `${point.x}`);
    ripple.setAttribute("cy", `${point.y}`);
    ripple.setAttribute("r", "4");
    ripple.setAttribute("opacity", "0.42");
    activationWaveRef.current = { x: point.x, y: point.y, startedAt: performance.now() };
    const activatedNodes = [...networkNodes].sort((a, b) => {
      const aPosition = nodePositionsRef.current.get(a.id) ?? a;
      const bPosition = nodePositionsRef.current.get(b.id) ?? b;
      return Math.hypot(aPosition.x - point.x, aPosition.y - point.y) - Math.hypot(bPosition.x - point.x, bPosition.y - point.y);
    }).slice(0, 8);
    activationNodeIdsRef.current = new Set(activatedNodes.map(node => node.id));
    activationDelaysRef.current = new Map(activatedNodes.map((node, index) => [node.id, index * 50]));
    if (activationFrameRef.current !== null) cancelAnimationFrame(activationFrameRef.current);
    const animateActivation = (now: number) => {
      // Keep activation visuals paused while a node is being dragged so WebKit only
      // composites the local node/edge mutations from the drag frame.
      if (!dragRef.current) renderVisuals(visualsRef.current, now);
      if (!activationWaveRef.current || now - activationWaveRef.current.startedAt >= 720) {
        activationWaveRef.current = null;
        activationNodeIdsRef.current.clear();
        activationDelaysRef.current.clear();
        activationFrameRef.current = null;
        renderVisuals(visualsRef.current, now);
        return;
      }
      activationFrameRef.current = requestAnimationFrame(animateActivation);
    };
    activationFrameRef.current = requestAnimationFrame(animateActivation);
    let startedAt: number | null = null;
    const animateRipple = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / 560);
      ripple.setAttribute("r", `${4 + 38 * progress}`);
      ripple.setAttribute("opacity", `${0.42 * (1 - progress) ** 2}`);
      rippleFrameRef.current = progress < 1 ? requestAnimationFrame(animateRipple) : null;
    };
    rippleFrameRef.current = requestAnimationFrame(animateRipple);
  };

  const returnNodeToBase = (id: string) => {
    if (returnFrameRef.current !== null) cancelAnimationFrame(returnFrameRef.current);
    const node = networkNodeById.get(id);
    const start = nodePositionsRef.current.get(id);
    if (!node || !start) {
      resumeAmbientRef.current();
      return;
    }
    let startedAt: number | null = null;
    const animateReturn = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / 420);
      const easeOut = 1 - (1 - progress) ** 3;
      nodePositionsRef.current.set(id, { x: start.x + (node.x - start.x) * easeOut, y: start.y + (node.y - start.y) * easeOut });
      const visuals = createVisuals(id, 1 - progress);
      visualsRef.current = visuals;
      renderVisuals(visuals, now);
      if (progress < 1) {
        returnFrameRef.current = requestAnimationFrame(animateReturn);
        return;
      }
      nodePositionsRef.current.set(id, { x: node.x, y: node.y });
      activeNodeRef.current = null;
      visualsRef.current = createVisuals(null);
      returnFrameRef.current = null;
      renderVisuals(visualsRef.current, now);
      resumeAmbientRef.current();
    };
    returnFrameRef.current = requestAnimationFrame(animateReturn);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (reducedMotionRef.current) return;
    // Active drags are tracked on window so Safari keeps reporting movement after
    // the pointer leaves an SVG child or loses child-level capture.
    if (dragRef.current) return;
    if (event.pointerType === "touch") return;
    const target = event.target as Element;
    const hoveredNodeId = target.closest("[data-network-node-id]")?.getAttribute("data-network-node-id") ?? null;
    svgRef.current?.style.setProperty("cursor", hoveredNodeId ? "grab" : "default");
    renderHover(hoveredNodeId);
  };

  const handlePointerLeave = () => {
    if (dragRef.current || reducedMotionRef.current) return;
    svgRef.current?.style.setProperty("cursor", "default");
    renderHover(null);
  };

  const finishDragByPointerId = (pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    const pending = pendingDragPointRef.current;
    if (dragRenderFrameRef.current !== null) cancelAnimationFrame(dragRenderFrameRef.current);
    dragRenderFrameRef.current = null;
    pendingDragPointRef.current = null;
    if (pending?.pointerId === pointerId) {
      const point = toSvgPoint(pending.clientX, pending.clientY);
      if (point) renderDraggedNode(drag.id, Math.max(16, Math.min(384, point.x)), Math.max(16, Math.min(204, point.y)));
    }
    stopWindowDragTrackingRef.current?.();
    stopWindowDragTrackingRef.current = null;
    if (svgRef.current) svgRef.current.style.cursor = "default";
    returnNodeToBase(drag.id);
  };

  const beginNodeDrag = (event: React.PointerEvent<SVGCircleElement>, nodeId: string) => {
    if (reducedMotionRef.current) return;
    if (returnFrameRef.current !== null) cancelAnimationFrame(returnFrameRef.current);
    if (ambientFrameRef.current !== null) cancelAnimationFrame(ambientFrameRef.current);
    ambientFrameRef.current = null;
    if (dragRenderFrameRef.current !== null) cancelAnimationFrame(dragRenderFrameRef.current);
    dragRenderFrameRef.current = null;
    pendingDragPointRef.current = null;
    stopWindowDragTrackingRef.current?.();
    stopWindowDragTrackingRef.current = null;
    event.stopPropagation();
    event.preventDefault();
    dragRef.current = { id: nodeId, pointerId: event.pointerId };
    activeNodeRef.current = nodeId;
    if (svgRef.current) svgRef.current.style.cursor = "grabbing";
    const visuals = createVisuals(nodeId, 1);
    visualsRef.current = visuals;
    renderVisuals(visuals, performance.now());

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== moveEvent.pointerId) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      scheduleDraggedNodeRender(moveEvent.pointerId, moveEvent.clientX, moveEvent.clientY);
    };
    const handleWindowPointerEnd = (endEvent: PointerEvent) => finishDragByPointerId(endEvent.pointerId);
    const stopWindowDragTracking = () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
    stopWindowDragTrackingRef.current = stopWindowDragTracking;
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (reducedMotionRef.current) return;
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) return;
    startBackgroundActivation(point);
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopAmbient = () => {
      if (ambientFrameRef.current !== null) cancelAnimationFrame(ambientFrameRef.current);
      ambientFrameRef.current = null;
    };
    const animateAmbient = (now: number) => {
      if (!dragRef.current) renderVisuals(visualsRef.current, now);
      ambientFrameRef.current = requestAnimationFrame(animateAmbient);
    };
    const startAmbient = () => {
      if (ambientFrameRef.current === null && visibleRef.current && !reducedMotionRef.current) ambientFrameRef.current = requestAnimationFrame(animateAmbient);
    };
    resumeAmbientRef.current = startAmbient;
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting;
      if (entry.isIntersecting) startAmbient(); else stopAmbient();
    }, { threshold: 0.01 });
    if (svgRef.current) observer.observe(svgRef.current);
    const updateMotionPreference = () => {
      reducedMotionRef.current = media.matches;
      if (media.matches) {
        stopAmbient();
        stopWindowDragTrackingRef.current?.();
        stopWindowDragTrackingRef.current = null;
        dragRef.current = null;
        activeNodeRef.current = null;
        activationWaveRef.current = null;
        activationNodeIdsRef.current.clear();
        activationDelaysRef.current.clear();
        if (activationFrameRef.current !== null) cancelAnimationFrame(activationFrameRef.current);
        if (returnFrameRef.current !== null) cancelAnimationFrame(returnFrameRef.current);
        if (dragRenderFrameRef.current !== null) cancelAnimationFrame(dragRenderFrameRef.current);
        activationFrameRef.current = null;
        returnFrameRef.current = null;
        dragRenderFrameRef.current = null;
        pendingDragPointRef.current = null;
        pulseRouteRef.current = [];
        activeEdgeCountRef.current.clear();
        edgeHighlightRef.current.clear();
        networkNodes.forEach(node => nodePositionsRef.current.set(node.id, { x: node.x, y: node.y }));
        visualsRef.current = createVisuals(null);
        renderVisuals(visualsRef.current, 0, false);
      } else startAmbient();
    };
    updateMotionPreference();
    media.addEventListener("change", updateMotionPreference);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateMotionPreference);
      stopAmbient();
      resumeAmbientRef.current = () => {};
      stopWindowDragTrackingRef.current?.();
      stopWindowDragTrackingRef.current = null;
      if (rippleFrameRef.current !== null) cancelAnimationFrame(rippleFrameRef.current);
      if (activationFrameRef.current !== null) cancelAnimationFrame(activationFrameRef.current);
      if (returnFrameRef.current !== null) cancelAnimationFrame(returnFrameRef.current);
      if (dragRenderFrameRef.current !== null) cancelAnimationFrame(dragRenderFrameRef.current);
    };
  // The visual callbacks only read and write SVG refs, so this lifecycle is intentionally mount-only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <svg ref={svgRef} className="data-network-graphic" viewBox="0 0 400 220" aria-hidden="true" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} onPointerDown={handlePointerDown}>
    <rect className="data-network-hit-area" x="0" y="0" width="400" height="220" fill="transparent" pointerEvents="all"/>
    <g className="data-network-scene">
      <g className="data-network-lines" pointerEvents="none">{networkEdges.map(([from, to]) => { const fromNode = networkNodeById.get(from)!; const toNode = networkNodeById.get(to)!; return <line key={`${from}-${to}`} ref={element => { if (element) edgeRefs.current.set(`${from}-${to}`, element); }} x1={fromNode.x} y1={fromNode.y} x2={toNode.x} y2={toNode.y} opacity="0.18" pointerEvents="none"/>; })}</g>
      <g className="data-network-orbitals" pointerEvents="none">{networkOrbitals.map(orbital => { const node = networkNodeById.get(orbital.id)!; return <circle key={orbital.id} ref={element => { if (element) orbitalRefs.current.set(orbital.id, element); }} cx={node.x} cy={node.y} r={orbital.r} opacity="0.11" strokeDasharray="8 11"/>; })}</g>
      <g className="data-network-halos" pointerEvents="none">{networkNodes.filter(node => networkPrimaryNodeIds.has(node.id)).map(node => <circle key={node.id} ref={element => { if (element) haloRefs.current.set(node.id, element); }} cx={node.x} cy={node.y} r={node.r * 2.35} opacity="0"/>)}</g>
      <g className="data-network-nodes" pointerEvents="none">{networkNodes.map(node => <g key={node.id} data-network-node-id={node.id} ref={element => { if (element) nodeRefs.current.set(node.id, element); }} opacity={networkPrimaryNodeIds.has(node.id) ? "0.32" : "0.28"} pointerEvents="none"><circle ref={element => { if (element) nodeCircleRefs.current.set(node.id, element); }} cx={node.x} cy={node.y} r={node.r} className={node.ring ? "data-network-ring" : "data-network-node"}/><circle cx={node.x} cy={node.y} r="22" className="data-network-node-hit-area" fill="transparent" pointerEvents="all" onPointerDown={event => beginNodeDrag(event, node.id)}/></g>)}</g>
      <g className="data-network-pulses" pointerEvents="none">{networkPulses.map(pulse => <circle key={pulse.id} ref={element => { if (element) pulseRefs.current.set(pulse.id, element); }} r="1.7" opacity="0"/>)}</g>
    </g>
    <circle ref={rippleRef} className="data-network-ripple" cx="0" cy="0" r="0" opacity="0"/>
  </svg>;
}

const cv = {
  zh: {
    intro: ["这是一个可公开发布的双语个人网站模板。请将示例内容替换为你自己的、已确认可公开的信息。", "模板展示数据分析、信息系统和产品项目的常见呈现方式；所有姓名、机构和链接均为示例。"],
    nav: ["经历", "项目", "技能", "奖项", "联系"],
    education: "教育背景", experience: "实习经历", projectHeading: "项目经历", skills: "技能", honors: "荣誉奖项",
    edu: [
      ["本科教育", "学位项目", "20XX — 20XX", "GPA: 示例"],
      ["研究生教育", "学位项目", "20XX — 20XX", "GPA: 示例"],
      ["学术项目", "课程名称", "课程说明", "20XX", "示例成绩", "这是用于展示教育经历的通用课程内容。"],
    ],
    jobs: [
      ["示例科技公司", "数据分析实习生", "2024.06 — 2024.08", "整理示例运营数据并制作可复用的分析报告。\n使用公开指标比较渠道表现，为团队讨论提供参考。"],
      ["Example Lab", "课程助教", "2024.03 — 2024.06", "协助组织编程练习并提供基础答疑。\n将常见问题整理为匿名化的学习资料。"],
    ],
    projects: [
      ["示例分析项目", "数据分析 · 项目实践", "2024.05 — 2024.06", ["数据整理", "指标分析", "结果汇总"], "使用示例数据完成基础整理、分析与结果汇总。\n对不同方案进行比较，并记录主要发现。\n将分析结果整理为简洁的项目说明。", ""],
      ["示例流程设计项目", "流程设计 · 项目管理", "2024.03 — 2024.04", ["流程梳理", "资源规划", "方案优化"], "设计从需求到交付的示例流程。\n识别关键环节并提出可执行的优化建议。\n将流程与改进思路整理为结构化文档。", ""],
    ] satisfies Project[],
    skillGroups: [["编程", "Python · SQL · TypeScript"], ["数据与系统", "关系数据库 · API · 数据建模"], ["分析", "数据清洗 · 可视化 · 业务分析"], ["工具", "Git · Excel · 文档协作"], ["语言", "中文 · English"]],
    honorsList: [["示例项目成果", "2024"], ["示例学术荣誉", "2023"]],
    contact: "联系", availability: "欢迎就项目实践、专业学习与职业发展进行交流。", portfolioLabel: "中文简历", portfolioHref: "/resume_zh.pdf", kaggleLabel: "查看示例", updatedAt: "示例更新日期", linkedInLabel: "LinkedIn", linkedInHref: "https://www.linkedin.com/in/demo-user/",
  },
  en: {
    intro: ["This is a public bilingual portfolio template. Replace the sample text with information you have confirmed is safe to publish.", "It demonstrates common sections for data analytics, information systems, and product work. All names, organisations, and links are examples."],
    nav: ["Experience", "Projects", "Skills", "Awards", "Contact"],
    education: "Education", experience: "Internship Experience", projectHeading: "Academic Projects", skills: "Skills", honors: "Honours & Awards",
    edu: [
      ["Undergraduate Education", "Degree Program", "20XX — 20XX", "GPA: Example"],
      ["Graduate Education", "Degree Program", "20XX — 20XX", "GPA: Example"],
      ["Academic Program", "Course Title", "Course Description", "20XX", "Sample grade", "This is a general course description for an education entry."],
    ],
    jobs: [
      ["Example Technology Company", "Data Analytics Intern", "Jun 2024 — Aug 2024", "Organised sample operational data and prepared reusable analysis reports.\nCompared public metrics to support team discussions."],
      ["Example Lab", "Teaching Assistant", "Mar 2024 — Jun 2024", "Helped organise programming exercises and answer introductory questions.\nTurned recurring questions into anonymised learning materials."],
    ],
    projects: [
      ["Example Analysis Project", "Data Analysis · Project Practice", "May 2024 — Jun 2024", ["Data Preparation", "Metric Analysis", "Result Summary"], "Used sample data to complete basic preparation, analysis, and result summarization.\nCompared alternative approaches and documented key observations.\nPresented the findings in a concise project summary.", ""],
      ["Example Process Design Project", "Process Design · Project Management", "Mar 2024 — Apr 2024", ["Process Mapping", "Resource Planning", "Solution Improvement"], "Designed a sample workflow from requirements to delivery.\nIdentified key stages and proposed practical improvements.\nDocumented the workflow and improvement ideas in a structured format.", ""],
    ] satisfies Project[],
    skillGroups: [["Programming", "Python · SQL · TypeScript"], ["Data & Systems", "Relational Databases · APIs · Data Modelling"], ["Analytics", "Data Cleaning · Visualisation · Business Analysis"], ["Tools", "Git · Excel · Documentation"], ["Languages", "Chinese · English"]],
    honorsList: [["Example Project Outcome", "2024"], ["Example Academic Honour", "2023"]],
    contact: "Contact", availability: "Open to discussions on projects, learning, and professional development.", portfolioLabel: "English Resume", portfolioHref: "/resume_en.pdf", kaggleLabel: "View example", updatedAt: "Sample update date", linkedInLabel: "LinkedIn", linkedInHref: "https://www.linkedin.com/in/demo-user/",
  },
};

export default function Home() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [isLocaleReady, setIsLocaleReady] = useState(false);
  const hasExplicitLocaleChoiceRef = useRef(false);
  const pendingScrollRef = useRef<ScrollSnapshot | null>(null);
  const anchorScrollBufferRef = useRef<HTMLDivElement | null>(null);
  const scrollSequenceRef = useRef(0);
  const contactHashRestoreRef = useRef(false);
  const hasRestoredReloadScrollRef = useRef(false);
  const reloadAnchorSnapshotRef = useRef<SavedScrollSnapshot | null>(null);
  const heroIntroMainRef = useRef<HTMLDivElement | null>(null);
  const heroPortraitRef = useRef<HTMLElement | null>(null);
  const [isContactBufferActive, setIsContactBufferActive] = useState(false);
  const setPreferredLocale = (nextLocale: Locale) => {
    hasExplicitLocaleChoiceRef.current = true;
    try {
      window.localStorage.setItem(preferredLanguageStorageKey, nextLocale);
    } catch {
      // Keep the in-memory choice when storage is unavailable.
    }
    setLocale(nextLocale);
  };
  useLayoutEffect(() => {
    let snapshot: SavedScrollSnapshot | null = null;
    let savedScrollY = Number.NaN;
    let savedPath: string | null = null;
    try {
      savedScrollY = Number(window.sessionStorage.getItem(reloadScrollYStorageKey));
      savedPath = window.sessionStorage.getItem(reloadScrollPathStorageKey);
      const savedBuffer = window.sessionStorage.getItem(reloadContactBufferStorageKey);
      if (savedBuffer) snapshot = JSON.parse(savedBuffer) as SavedScrollSnapshot;
      if (!Number.isFinite(savedScrollY) || !snapshot) {
        const saved = window.sessionStorage.getItem(scrollPositionStorageKey);
        if (saved) {
          const legacySnapshot = JSON.parse(saved) as Partial<SavedScrollSnapshot>;
          if (!Number.isFinite(savedScrollY) && typeof legacySnapshot.scrollY === "number") savedScrollY = legacySnapshot.scrollY;
          if (!snapshot && typeof legacySnapshot.scrollY === "number") snapshot = legacySnapshot as SavedScrollSnapshot;
        }
      }
      if (!savedPath && snapshot?.hash) savedPath = window.location.pathname + snapshot.hash;
    } catch {
      // Direct hash navigation falls back to the canonical anchor position.
    }
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const isReload = navigation?.type === "reload";
    const currentPath = window.location.pathname + window.location.hash;
    const sectionId = window.location.hash.slice(1);
    const hasExactAnchorSnapshot = Boolean(isReload && scrollSectionIds.includes(sectionId) && savedPath === currentPath && Number.isFinite(savedScrollY) && savedScrollY >= 0);
    reloadAnchorSnapshotRef.current = hasExactAnchorSnapshot ? {
      scrollY: savedScrollY,
      hash: window.location.hash,
      bufferHeight: snapshot?.bufferHeight ?? 0,
      bufferMarginBottom: snapshot?.bufferMarginBottom ?? "",
      isContactBufferActive: snapshot?.isContactBufferActive ?? sectionId === "contact",
      wasDividerAligned: snapshot?.wasDividerAligned ?? false,
    } : null;
    contactHashRestoreRef.current = window.location.hash === "#contact" && !hasExactAnchorSnapshot;
  }, []);
  const t = cv[locale];
  const contactFocusItems = locale === "zh" ? [["数据与分析", ""], ["商业与管理", ""], ["技术与系统", ""], ["项目与实践", ""]] : [["Data & Analysis", ""], ["Business & Management", ""], ["Technology & Systems", ""], ["Projects & Practice", ""]];
  const contactStatusItems = locale === "zh" ? [{ type: "study", title: "示例模板", detail: "请替换为公开信息" }, { type: "graduation", title: "示例日期", detail: "使用年份或月份即可" }, { type: "open", title: "开放交流", detail: "项目交流 · 学习讨论 · 合作机会" }] : [{ type: "study", title: "Example Template", detail: "Replace with public information" }, { type: "graduation", title: "Example Date", detail: "Use a year or month" }, { type: "open", title: "Open to Discussions", detail: "Projects · Learning · Collaboration" }];
  useLayoutEffect(() => {
    let isCurrent = true;
    const controller = new AbortController();
    let savedLocale: string | null = null;

    try {
      savedLocale = window.localStorage.getItem(preferredLanguageStorageKey);
    } catch {
      // Fall through to first-visit detection when storage is unavailable.
    }

    if (savedLocale === "zh" || savedLocale === "en") {
      hasExplicitLocaleChoiceRef.current = true;
      setLocale(savedLocale);
      setIsLocaleReady(true);
      return () => { isCurrent = false; };
    }

    const browserFallback: Locale = /^zh(?:-|$)/i.test(navigator.languages?.[0] ?? navigator.language) ? "zh" : "en";
    const applyDetectedLocale = (nextLocale: Locale) => {
      if (isCurrent && !hasExplicitLocaleChoiceRef.current) {
        setLocale(nextLocale);
        setIsLocaleReady(true);
      }
    };

    void fetch("https://ipapi.co/json/", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("IP region lookup failed");
        const result = await response.json() as { country_code?: string };
        applyDetectedLocale(result.country_code ? (result.country_code === "CN" ? "zh" : "en") : browserFallback);
      })
      .catch(() => applyDetectedLocale(browserFallback));

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    const saveScrollPosition = () => {
      try {
        const buffer = anchorScrollBufferRef.current;
        const section = document.getElementById(window.location.hash.slice(1));
        const nav = document.querySelector(".sticky-nav nav");
        const snapshot = {
          scrollY: window.scrollY,
          hash: window.location.hash,
          bufferHeight: buffer?.offsetHeight ?? 0,
          bufferMarginBottom: buffer?.style.marginBottom ?? "",
          isContactBufferActive: buffer?.classList.contains("is-active") ?? false,
          wasDividerAligned: Boolean(section && nav && Math.abs(section.getBoundingClientRect().top - nav.getBoundingClientRect().bottom) <= 1),
        } satisfies SavedScrollSnapshot;
        window.sessionStorage.setItem(scrollPositionStorageKey, JSON.stringify(snapshot));
        window.sessionStorage.setItem(reloadScrollYStorageKey, String(snapshot.scrollY));
        window.sessionStorage.setItem(reloadScrollPathStorageKey, window.location.pathname + window.location.hash);
        window.sessionStorage.setItem(reloadContactBufferStorageKey, JSON.stringify(snapshot));
      } catch {
        // Native history restoration remains available when session storage is unavailable.
      }
    };

    let saveFrame: number | null = null;
    const scheduleScrollSave = () => {
      if (saveFrame !== null) return;
      saveFrame = requestAnimationFrame(() => {
        saveFrame = null;
        saveScrollPosition();
      });
    };
    const saveBeforeUnload = () => {
      if (saveFrame !== null) cancelAnimationFrame(saveFrame);
      saveFrame = null;
      saveScrollPosition();
    };
    window.addEventListener("scroll", scheduleScrollSave, { passive: true });
    window.addEventListener("pagehide", saveBeforeUnload);
    window.addEventListener("beforeunload", saveBeforeUnload);
    return () => {
      if (saveFrame !== null) cancelAnimationFrame(saveFrame);
      window.removeEventListener("scroll", scheduleScrollSave);
      window.removeEventListener("pagehide", saveBeforeUnload);
      window.removeEventListener("beforeunload", saveBeforeUnload);
    };
  }, []);
  useLayoutEffect(() => {
    if (!isLocaleReady) return;
    const reloadAnchorSnapshot = reloadAnchorSnapshotRef.current;
    if (reloadAnchorSnapshot) {
      hasRestoredReloadScrollRef.current = true;
      contactHashRestoreRef.current = false;
      const buffer = anchorScrollBufferRef.current;
      const sectionId = reloadAnchorSnapshot.hash.slice(1);
      const shouldRestoreContactBuffer = sectionId === "awards" || sectionId === "contact";
      if (buffer && shouldRestoreContactBuffer && reloadAnchorSnapshot.bufferHeight > 0) {
        buffer.style.height = `${reloadAnchorSnapshot.bufferHeight}px`;
        if (reloadAnchorSnapshot.bufferMarginBottom) buffer.style.marginBottom = reloadAnchorSnapshot.bufferMarginBottom;
      }
      if (shouldRestoreContactBuffer) setIsContactBufferActive(reloadAnchorSnapshot.isContactBufferActive);
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      const restoreExactScroll = () => {
        const missingScrollRange = Math.max(0, reloadAnchorSnapshot.scrollY - (document.documentElement.scrollHeight - window.innerHeight));
        if (buffer && missingScrollRange > 0) buffer.style.height = `${buffer.offsetHeight + missingScrollRange}px`;
        window.scrollTo({ top: reloadAnchorSnapshot.scrollY, behavior: "auto" });
      };
      const correctDividerAlignment = () => {
        if (!reloadAnchorSnapshot.wasDividerAligned) return;
        const target = document.getElementById(sectionId);
        const nav = document.querySelector(".sticky-nav nav");
        if (!target || !nav) return;
        const correction = target.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
        if (Math.abs(correction) <= 0.25) return;
        const targetScroll = window.scrollY + correction;
        const missingScrollRange = Math.max(0, targetScroll - (document.documentElement.scrollHeight - window.innerHeight));
        if (buffer && missingScrollRange > 0) buffer.style.height = `${buffer.offsetHeight + missingScrollRange}px`;
        window.scrollBy({ top: correction, behavior: "auto" });
      };
      let restoreBehaviorFrame: number | null = null;
      let layoutFrame: number | null = null;
      let verifyAlignmentFrame: number | null = null;
      const finishReloadRestore = () => {
        restoreExactScroll();
        layoutFrame = requestAnimationFrame(() => requestAnimationFrame(() => {
          correctDividerAlignment();
          verifyAlignmentFrame = requestAnimationFrame(() => {
            correctDividerAlignment();
            restoreBehaviorFrame = requestAnimationFrame(() => {
              root.style.scrollBehavior = previousScrollBehavior;
            });
          });
        }));
      };
      restoreExactScroll();
      reloadAnchorSnapshotRef.current = null;
      if (document.readyState === "complete") finishReloadRestore();
      else window.addEventListener("load", finishReloadRestore, { once: true });
      return () => {
        window.removeEventListener("load", finishReloadRestore);
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        if (verifyAlignmentFrame !== null) cancelAnimationFrame(verifyAlignmentFrame);
        if (restoreBehaviorFrame !== null) cancelAnimationFrame(restoreBehaviorFrame);
        root.style.scrollBehavior = previousScrollBehavior;
      };
    }
    if (window.location.hash === "#contact") return;
    let savedScrollPosition: string | null = null;

    try {
      savedScrollPosition = window.sessionStorage.getItem(scrollPositionStorageKey);
    } catch {
      return;
    }

    let savedSnapshot = Number(savedScrollPosition);
    if (!Number.isFinite(savedSnapshot)) {
      try {
        const saved = JSON.parse(savedScrollPosition ?? "") as Partial<SavedScrollSnapshot>;
        savedSnapshot = typeof saved.scrollY === "number" ? saved.scrollY : Number.NaN;
      } catch {
        return;
      }
    }
    if (savedSnapshot < 0) return;
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo({ top: savedSnapshot, behavior: "auto" });
    const restoreBehaviorFrame = requestAnimationFrame(() => {
      root.style.scrollBehavior = previousScrollBehavior;
    });
    return () => cancelAnimationFrame(restoreBehaviorFrame);
  }, [isLocaleReady]);
  useEffect(() => {
    const introMain = heroIntroMainRef.current;
    const portrait = heroPortraitRef.current;
    if (!introMain || !portrait) return;

    const tabletMedia = window.matchMedia("(min-width: 641px) and (max-width: 900px)");
    const alignPortraitToIntro = () => {
      if (!tabletMedia.matches) {
        portrait.style.transform = "";
        return;
      }
      portrait.style.transform = "none";
      const introRect = introMain.getBoundingClientRect();
      const portraitRect = portrait.getBoundingClientRect();
      const delta = introRect.top + introRect.height / 2 - (portraitRect.top + portraitRect.height / 2);
      portrait.style.transform = `translateY(${delta}px)`;
    };

    const observer = new ResizeObserver(alignPortraitToIntro);
    observer.observe(introMain);
    observer.observe(portrait);
    tabletMedia.addEventListener("change", alignPortraitToIntro);
    window.addEventListener("resize", alignPortraitToIntro);
    alignPortraitToIntro();
    return () => {
      observer.disconnect();
      tabletMedia.removeEventListener("change", alignPortraitToIntro);
      window.removeEventListener("resize", alignPortraitToIntro);
      portrait.style.transform = "";
    };
  }, [isLocaleReady, locale]);
  const toBullets = (text: string) => text.includes("\n") ? text.split("\n").map(item => item.trim()).filter(Boolean) : text.split(locale === "zh" ? /[；。]/ : /\.\s+(?=[A-Z])/).map(item => item.trim()).filter(Boolean);
  const renderProjectBullet = (item: string) => <>{item.split(/(80\.75%|0\.80000)/g).map((part, index) => part === "80.75%" || part === "0.80000" ? <strong className="project-result" key={index}>{part}</strong> : part)}</>;
  const scrollToSection = (id: string, instant = false) => {
    const sequence = ++scrollSequenceRef.current;
    window.history.pushState(null, "", `#${id}`);
    const buffer = anchorScrollBufferRef.current;
    if (buffer) {
      buffer.style.height = "0px";
      buffer.style.removeProperty("margin-bottom");
      buffer.querySelector<HTMLElement>(".contact-extension-network")?.style.removeProperty("display");
    }
    const getBufferMarginCompensation = () => {
      if (!buffer || window.matchMedia("(max-width: 720px)").matches) return 0;
      return parseFloat(getComputedStyle(buffer.parentElement ?? document.documentElement).paddingBottom) || 0;
    };
    const setAnchorBufferHeight = (height: number) => {
      if (!buffer) return;
      buffer.style.height = `${height}px`;
      const marginCompensation = getBufferMarginCompensation();
      if (marginCompensation > 0) buffer.style.marginBottom = `-${marginCompensation}px`;
    };
    const getMinimumBufferHeight = (requiredExtra: number, includesExtension: boolean) => {
      const extensionHeight = includesExtension && buffer ? buffer.scrollHeight : 0;
      return Math.max(extensionHeight, requiredExtra + getBufferMarginCompensation());
    };
    const rebalanceBuffer = (target: HTMLElement, nav: Element, includesExtension: boolean) => {
      if (!buffer || buffer.offsetHeight === 0) return;
      const marginCompensation = getBufferMarginCompensation();
      const currentContribution = Math.max(0, buffer.offsetHeight - marginCompensation);
      const baseMaxScroll = document.documentElement.scrollHeight - window.innerHeight - currentContribution;
      const desiredScroll = window.scrollY + target.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
      const requiredExtra = Math.max(0, desiredScroll - baseMaxScroll);
      setAnchorBufferHeight(getMinimumBufferHeight(requiredExtra, includesExtension));
    };
    setIsContactBufferActive(false);
    const performScroll = () => {
      const element = document.getElementById(id);
      if (!element) return;

      if (dividerAlignedSectionIds.has(id)) {
        const nav = document.querySelector(".sticky-nav nav");
        if (!nav) return;
        const includesExtension = id === "awards";
        const scrollToDivider = () => {
          if (scrollSequenceRef.current !== sequence) return;
          const navBottom = nav.getBoundingClientRect().bottom;
          const sectionTop = element.getBoundingClientRect().top;
          const correctAlignment = (scheduleRebalance = true) => {
            if (scrollSequenceRef.current !== sequence) return;
            const correction = element.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
            const threshold = window.matchMedia("(max-width: 720px)").matches ? 0.01 : 0.5;
            if (Math.abs(correction) > threshold) window.scrollBy({ top: correction, behavior: "auto" });
            if (scheduleRebalance) requestAnimationFrame(() => requestAnimationFrame(() => rebalanceBuffer(element, nav, includesExtension)));
          };
          if (instant) {
            window.scrollBy({ top: sectionTop - navBottom, behavior: "auto" });
            correctAlignment(false);
            rebalanceBuffer(element, nav, includesExtension);
            return;
          }
          const supportsScrollEnd = "onscrollend" in (window as object);
          if (supportsScrollEnd) {
            window.addEventListener("scrollend", correctAlignment, { once: true });
            window.scrollBy({ top: sectionTop - navBottom, behavior: "smooth" });
            return;
          }
          window.scrollBy({ top: sectionTop - navBottom, behavior: "smooth" });
          let previousScrollY = window.scrollY;
          let settledFrames = 0;
          const waitForSettledScroll = () => {
            const currentScrollY = window.scrollY;
            settledFrames = Math.abs(currentScrollY - previousScrollY) <= 0.01 ? settledFrames + 1 : 0;
            previousScrollY = currentScrollY;
            if (settledFrames >= 2) correctAlignment();
            else requestAnimationFrame(waitForSettledScroll);
          };
          requestAnimationFrame(() => requestAnimationFrame(waitForSettledScroll));
        };
        const delta = element.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
        const availableScroll = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
        const requiredExtra = Math.max(0, delta - availableScroll);
        const isMobile = window.matchMedia("(max-width: 720px)").matches;
        const needsBuffer = requiredExtra > 0 || (id === "awards" && isMobile);
        if (buffer && needsBuffer) {
          setAnchorBufferHeight(getMinimumBufferHeight(requiredExtra, includesExtension));
          if (includesExtension) setIsContactBufferActive(true);
          requestAnimationFrame(scrollToDivider);
        } else {
          scrollToDivider();
        }
        return;
      }

      if (id === "contact") {
        const nav = document.querySelector(".sticky-nav nav");
        if (!nav) return;
        const targetScroll = window.scrollY + element.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const requiredExtra = Math.max(0, targetScroll - maxScroll);
        if (buffer && requiredExtra > 0) {
          setAnchorBufferHeight(getMinimumBufferHeight(requiredExtra, true));
          setIsContactBufferActive(true);
        }
        const scrollToContact = () => {
          if (scrollSequenceRef.current !== sequence) return;
          const navBottom = nav.getBoundingClientRect().bottom;
          const contactTop = element.getBoundingClientRect().top;
          const correctAlignment = (scheduleRebalance = true) => {
            if (scrollSequenceRef.current !== sequence) return;
            const correction = element.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
            const threshold = window.matchMedia("(max-width: 720px)").matches ? 0.01 : 0.5;
            if (Math.abs(correction) > threshold) window.scrollBy({ top: correction, behavior: "auto" });
            if (scheduleRebalance) requestAnimationFrame(() => requestAnimationFrame(() => rebalanceBuffer(element, nav, true)));
          };
          if (instant) {
            window.scrollBy({ top: contactTop - navBottom, behavior: "auto" });
            correctAlignment(false);
            rebalanceBuffer(element, nav, true);
            return;
          }
          const supportsScrollEnd = "onscrollend" in (window as object);
          if (supportsScrollEnd) {
            window.addEventListener("scrollend", correctAlignment, { once: true });
            window.scrollBy({ top: contactTop - navBottom, behavior: "smooth" });
            return;
          }
          window.scrollBy({ top: contactTop - navBottom, behavior: "smooth" });
          let previousScrollY = window.scrollY;
          let settledFrames = 0;
          const waitForSettledScroll = () => {
            const currentScrollY = window.scrollY;
            settledFrames = Math.abs(currentScrollY - previousScrollY) <= 0.01 ? settledFrames + 1 : 0;
            previousScrollY = currentScrollY;
            if (settledFrames >= 2) correctAlignment();
            else requestAnimationFrame(waitForSettledScroll);
          };
          requestAnimationFrame(() => requestAnimationFrame(waitForSettledScroll));
        };
        if (instant) scrollToContact();
        else requestAnimationFrame(() => requestAnimationFrame(scrollToContact));
        return;
      }

      const nav = document.querySelector(".sticky-nav");
      if (!nav) return;
      const targetTop = Math.max(0, window.scrollY + element.getBoundingClientRect().top - nav.getBoundingClientRect().height - 18);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo({ top: targetTop, behavior: "smooth" });
        if (id !== "projects" || !window.matchMedia("(max-width: 720px)").matches) return;
        const dividerNav = document.querySelector(".sticky-nav nav");
        if (!dividerNav) return;
        const correctProjectsAlignment = () => {
          if (scrollSequenceRef.current !== sequence) return;
          const correction = element.getBoundingClientRect().top - dividerNav.getBoundingClientRect().bottom;
          if (Math.abs(correction) > 0.01) window.scrollBy({ top: correction, behavior: "auto" });
        };
        if ("onscrollend" in (window as object)) {
          window.addEventListener("scrollend", correctProjectsAlignment, { once: true });
          return;
        }
        let previousScrollY = window.scrollY;
        let settledFrames = 0;
        const waitForProjectsScroll = () => {
          const currentScrollY = window.scrollY;
          settledFrames = Math.abs(currentScrollY - previousScrollY) <= 0.01 ? settledFrames + 1 : 0;
          previousScrollY = currentScrollY;
          if (settledFrames >= 2) correctProjectsAlignment();
          else requestAnimationFrame(waitForProjectsScroll);
        };
        requestAnimationFrame(() => requestAnimationFrame(waitForProjectsScroll));
      }));
    };
    if (instant) performScroll();
    else requestAnimationFrame(performScroll);
  };
  useLayoutEffect(() => {
    if (!isLocaleReady || hasRestoredReloadScrollRef.current || window.location.hash !== "#contact" || !contactHashRestoreRef.current) return;
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    const restoreContact = () => scrollToSection("contact", true);
    let restoreBehaviorFrame: number | null = null;
    const finishInitialRestore = () => {
      restoreContact();
      restoreBehaviorFrame = requestAnimationFrame(() => {
        root.style.scrollBehavior = previousScrollBehavior;
        contactHashRestoreRef.current = false;
      });
    };
    restoreContact();
    if (document.readyState === "complete") finishInitialRestore();
    else window.addEventListener("load", finishInitialRestore, { once: true });
    return () => {
      window.removeEventListener("load", finishInitialRestore);
      if (restoreBehaviorFrame !== null) cancelAnimationFrame(restoreBehaviorFrame);
      root.style.scrollBehavior = previousScrollBehavior;
    };
  }, [isLocaleReady, locale]);
  useEffect(() => {
    const releaseBuffer = () => {
      if (!anchorScrollBufferRef.current || anchorScrollBufferRef.current.offsetHeight === 0) return;
      const previousScrollY = window.scrollY;
      anchorScrollBufferRef.current.style.height = "0px";
      anchorScrollBufferRef.current.style.removeProperty("margin-bottom");
      setIsContactBufferActive(false);
      requestAnimationFrame(() => window.scrollTo({ top: Math.min(previousScrollY, document.documentElement.scrollHeight - window.innerHeight), behavior: "auto" }));
    };
    const releaseOnWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0) return;
      requestAnimationFrame(() => {
        const buffer = anchorScrollBufferRef.current;
        if (buffer && window.scrollY <= document.documentElement.scrollHeight - buffer.offsetHeight - window.innerHeight) releaseBuffer();
      });
    };
    const releaseOnKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) requestAnimationFrame(() => releaseBuffer());
    };
    window.addEventListener("wheel", releaseOnWheel, { passive: true });
    window.addEventListener("keydown", releaseOnKey);
    return () => { window.removeEventListener("wheel", releaseOnWheel); window.removeEventListener("keydown", releaseOnKey); };
  }, []);
  const switchLocale = () => {
    const navHeight = document.querySelector(".sticky-nav")?.getBoundingClientRect().height ?? 0;
    const viewportAnchor = window.scrollY + navHeight;
    const viewportMiddle = navHeight + (window.innerHeight - navHeight) / 2;
    const sections = scrollSectionIds.map(id => document.getElementById(id)).filter((section): section is HTMLElement => Boolean(section));
    const hashSection = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    const hashIsNearViewport = hashSection && Math.abs(hashSection.getBoundingClientRect().top - navHeight) <= navHeight;
    const section = hashIsNearViewport ? hashSection : sections.find(item => {
      const rect = item.getBoundingClientRect();
      return rect.top <= viewportMiddle && rect.bottom >= viewportMiddle;
    }) ?? sections.reduce<HTMLElement | undefined>((closest, item) => {
      if (!closest) return item;
      const itemDistance = Math.abs(item.getBoundingClientRect().top - viewportMiddle);
      const closestDistance = Math.abs(closest.getBoundingClientRect().top - viewportMiddle);
      return itemDistance < closestDistance ? item : closest;
    }, undefined);

    if (section) {
      const sectionTop = window.scrollY + section.getBoundingClientRect().top;
      const root = document.documentElement;
      const snapshot = {
        sectionId: section.id,
        progress: Math.min(1, Math.max(0, (viewportAnchor - sectionTop) / Math.max(section.offsetHeight, 1))),
        hash: window.location.hash,
        previousScrollBehavior: root.style.scrollBehavior,
      };
      pendingScrollRef.current = snapshot;
      // Temporarily override the site's smooth anchor scrolling for restoration.
      root.style.scrollBehavior = "auto";
      setPreferredLocale(locale === "zh" ? "en" : "zh");

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (pendingScrollRef.current !== snapshot) return;
          const nextSection = document.getElementById(snapshot.sectionId);
          if (!nextSection) return;

          const nextNavHeight = document.querySelector(".sticky-nav")?.getBoundingClientRect().height ?? 0;
          const nextSectionTop = window.scrollY + nextSection.getBoundingClientRect().top;
          const target = nextSectionTop + snapshot.progress * nextSection.offsetHeight - nextNavHeight;
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          const scrollTop = Math.min(Math.max(0, target), maxScroll);
          window.scrollTo({ top: scrollTop, behavior: "auto" });

          requestAnimationFrame(() => {
            const settledSection = document.getElementById(snapshot.sectionId);
            const settledNavHeight = document.querySelector(".sticky-nav")?.getBoundingClientRect().height ?? 0;
            if (settledSection) {
              const settledTop = window.scrollY + settledSection.getBoundingClientRect().top;
              const settledTarget = settledTop + snapshot.progress * settledSection.offsetHeight - settledNavHeight;
              const settledMaxScroll = document.documentElement.scrollHeight - window.innerHeight;
              window.scrollTo({ top: Math.min(Math.max(0, settledTarget), settledMaxScroll), behavior: "auto" });
            }
            pendingScrollRef.current = null;
            requestAnimationFrame(() => {
              document.documentElement.style.scrollBehavior = snapshot.previousScrollBehavior;
            });
          });
        });
      });
      return;
    }

    setPreferredLocale(locale === "zh" ? "en" : "zh");
  };
  if (!isLocaleReady) return null;
  return <main className={`locale-${locale}`}>
    <div className="sticky-nav"><nav><a className="nav-name" href="#about" onClick={(event) => { event.preventDefault(); scrollToSection("about"); }}>{locale === "zh" ? "关于我" : "About"}</a><div className="nav-links"><div className="nav-section-links">{t.nav.map((item, i) => { const id = ["experience", "projects", "skills", "awards", "contact"][i]; return <a key={item} href={`#${id}`} onClick={(event) => { event.preventDefault(); scrollToSection(id); }}>{item}</a>; })}</div><button aria-label="Switch language" onClick={switchLocale}>{locale === "zh" ? "EN" : "中文"}</button></div></nav></div>
    <header className="hero" id="about">
      <div className="hero-grid"><div className="hero-copy"><div className="hero-intro-main" ref={heroIntroMainRef}><h1 className={locale === "en" ? "english-name" : ""}>{locale === "zh" ? "示例用户" : "Demo User"}</h1><div className="intro">{t.intro.map((paragraph) => <p key={paragraph}>{renderIntroParagraph(paragraph, locale)}</p>)}</div></div><div className="hero-actions"><a className="cta" href="mailto:demo.user@example.com"><MailIcon/><span className="link-label">{locale === "zh" ? "发送邮件" : "Email"}</span><ExternalLinkIcon/></a><a className="resume-cta" href={t.portfolioHref} target="_blank" rel="noreferrer"><FileTextIcon/><span className="link-label">{t.portfolioLabel}</span><ExternalLinkIcon/></a><a className="resume-cta" href={t.linkedInHref} target="_blank" rel="noreferrer"><LinkedInIcon/><span className="link-label">LinkedIn</span><ExternalLinkIcon/></a><a className="resume-cta" href="https://github.com/demo-user" target="_blank" rel="noreferrer"><GitHubIcon/><span className="link-label">GitHub</span><ExternalLinkIcon/></a></div><div className="graduation-meta"><span className="label">{locale === "zh" ? "示例时间" : "Sample timeline"}</span><b className="value">2024</b></div></div><aside className="portrait-wrap" ref={heroPortraitRef} aria-label={locale === "zh" ? "示例头像占位符" : "Sample avatar placeholder"}><div className="portrait-placeholder" aria-hidden="true">DU</div></aside></div>
    </header>
    <section className="section education resume-section-grid" id="education"><div className="section-label">{t.education}</div><div className="timeline">{t.edu.map((x, i) => <article className={i === 2 ? "summer-school" : ""} key={x[0]}><div><h3>{x[0]}</h3><p className="education-program">{x[1]}</p>{i === 2 && <><p className="course-title">{x[2]}</p><p className="course-description">{locale === "zh" ? <>{x[5].slice(0, -"完成分析与模型评估。".length)}<span className="keep-phrase">完成分析与模型评估。</span></> : x[5]}</p></>}</div><div className="meta">{i === 2 ? <><b className="edu-period">{x[3]}</b><span className="edu-grade-list"><span className="edu-grade">{x[4]}</span></span></> : <><b className="edu-period">{x[2]}</b><span className="edu-grade-list">{String(x[3]).split(" · ").map((line) => <span className="edu-grade" key={line}>{line}</span>)}</span></>}</div></article>)}</div></section>
    <section className="section experience resume-section-grid" id="experience"><div className="section-label">{t.experience}</div><div className="timeline">{t.jobs.map((x) => <article key={x[0]}><div><h3>{x[0]}</h3><p className="job-title">{x[1]}</p>{x[4] && <p className="job-location">{x[4]}</p>}<span className="experience-mobile-period">{x[2]}</span><ul className="bullet-list">{toBullets(x[3]).map(item => <li key={item}>{item}</li>)}</ul></div><div className="meta"><b>{x[2]}</b></div></article>)}</div></section>
    <section className="section project-section resume-section-grid" id="projects"><div className="section-label">{t.projectHeading}</div><div className="timeline project-timeline">{t.projects.map((x) => <article key={x[0]}><div><h3>{x[0]}</h3><p className="project-subtitle">{x[1]}</p><span className="project-mobile-period">{x[2]}</span><p className="project-methods">{x[3].join(" · ")}</p><ul className="bullet-list">{toBullets(x[4]).map(item => <li key={item}>{renderProjectBullet(item)}</li>)}</ul>{x[5] && <a className="project-link" href={x[5]} target="_blank" rel="noreferrer">{t.kaggleLabel} <span>↗</span></a>}</div><div className="meta"><b>{x[2]}</b></div></article>)}</div></section>
    <section className="section skills-section" id="skills"><div className="section-label">{t.skills}</div><div className="skill-list">{t.skillGroups.map(x => <div key={x[0]}><b>{x[0]}</b><span>{x[1]}</span></div>)}</div></section>
    <section className="section awards-section resume-section-grid" id="awards"><div className="section-label">{t.honors}</div><div className="timeline awards-list">{t.honorsList.map(([name, year]) => <article key={name}><h3>{name}</h3><div className="meta"><b>{year}</b></div></article>)}</div></section>
    <footer id="contact"><p className="eyebrow contact-section-label">{t.contact}</p><h2>{locale === "zh" ? <>欢迎就<span className="keep-term">项目实践</span>、<span className="keep-term">专业学习</span>与<span className="keep-term">职业发展</span>进行交流。</> : t.availability}</h2><div className="contact-links"><div className="contact-link-group"><span className="contact-link-label">Email</span><a href="mailto:demo.user@example.com">demo.user@example.com <span>↗</span></a></div><div className="contact-link-group"><span className="contact-link-label">LinkedIn</span><a href={t.linkedInHref} target="_blank" rel="noreferrer">Demo profile <span>↗</span></a></div></div><div className="footer-meta"><span>Demo User</span><span>{t.updatedAt}</span><span>© 2026 Demo User</span></div></footer>
    <div ref={anchorScrollBufferRef} className={`anchor-scroll-buffer${isContactBufferActive ? " is-active" : ""}`} aria-hidden={!isContactBufferActive}>
      <section className="contact-extension">
        <div className="contact-extension-focus">
          <h3 className="contact-extension-heading">{locale === "zh" ? "当前关注" : "CURRENT FOCUS"}</h3>
          <div className="contact-focus-list">{contactFocusItems.map(([primary, secondary]) => <div className="contact-focus-item" key={primary}><p>{primary}</p>{secondary && <span>{secondary}</span>}</div>)}</div>
        </div>
        <div className="contact-extension-status">
          <h3 className="contact-extension-heading">{locale === "zh" ? "当前状态" : "CURRENT STATUS"}</h3>
          <div className="contact-status-list">{contactStatusItems.map(item => <div className="contact-status-item" key={item.title}><span className="contact-status-icon"><ContactStatusIcon type={item.type}/></span><div><p>{item.title}</p><span>{item.detail}</span></div></div>)}</div>
        </div>
        <div className="contact-extension-network"><DataNetworkGraphic/></div>
      </section>
    </div>
  </main>;
}
