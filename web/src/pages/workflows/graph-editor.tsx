/**
 * Graph Editor — SVG 기반 노드-엣지 워크플로우 편집기 (메인 컴포넌트).
 * 레이아웃 계산: graph-layout.ts, 노드 컴포넌트: graph-nodes.tsx
 */

import { useState, useRef, useEffect } from "react";
import { useT } from "../../i18n";
import { useConfirm } from "../../components/modal";
import { SearchInput } from "../../components/search-input";
import { NodePicker } from "./node-picker";
import type { NodePreset } from "./node-presets";

// ── Types (workflow-types.ts에서 re-export) ──
export type { AgentDef, CriticDef, PhaseDef, OrcheNodeType, OrcheNodeDef, NodeGroup, WorkflowDef, NodeType, SubNodeType, ToolNodeDef, SkillNodeDef, TriggerType, TriggerNodeDef, FieldMapping, GraphNode, EndNodeDef, EndOutputTarget } from "./workflow-types";
export type { NodePos, Edge, EdgeType } from "./graph-layout";
import type { PhaseDef, NodeGroup, WorkflowDef, OrcheNodeDef, TriggerType, TriggerNodeDef, EndNodeDef } from "./workflow-types";
import { get_frontend_node } from "./node-registry";

import { compute_positions, compute_aux_positions, compute_edges, compute_aux_edges, compute_layout_dir, PADDING } from "./graph-layout";
import type { NodePos, Edge, LayoutDir } from "./graph-layout";
import { EdgePath, PhaseNode, AuxNode, AddHandle, GroupFrame, is_orche_type, MODE_ICON, orche_icon } from "./graph-nodes";

// ── Main Graph Editor Component ──

type DragState = {
  from_id: string;
  from_port: string;   // output 포트 이름 ("result", "payload", "error" 등)
  mouse: { x: number; y: number };
} | null;

// ── Zoom/Pan 상수 ──

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.0;
const ZOOM_FACTOR = 1.12;   // 배율 방식 줌 (12% 씩)

export function GraphEditor({
  workflow,
  onChange,
  selectedPhaseId,
  onSelectPhase,
  onEditPhase,
  onRunNode,
  onEditSubNode,
  runningNodeId,
  orcheStates,
}: {
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  selectedPhaseId: string | null;
  onSelectPhase: (id: string | null) => void;
  onEditPhase?: (id: string) => void;
  /** 노드 단독 실행 콜백 (▶ 클릭 = "run", Shift+▶ = "test"). */
  onRunNode?: (id: string, mode: "run" | "test") => void;
  /** 클러스터 Sub-node 더블클릭 콜백 (phaseId__agentId 형식). */
  onEditSubNode?: (subNodeId: string) => void;
  /** 현재 실행 중인 노드 ID (펄스 이펙트 표시). */
  runningNodeId?: string | null;
  /** 오케 노드 실행 상태 (PhaseLoopState.orche_states). */
  orcheStates?: Array<{ node_id: string; status: string }>;
}) {
  const t = useT();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirm();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // NodePicker 상태
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<
    | { type: "handle"; source_id: string }
    | { type: "edge"; from_id: string; to_id: string }
    | null
  >(null);
  /** 드래그 드롭으로 노드 배치 시 SVG 좌표. */
  const [pickerDropPos, setPickerDropPos] = useState<{ x: number; y: number } | null>(null);

  // AddHandle 드래그 상태: +핸들에서 드래그 → 연결선 → 드롭 시 picker
  const [handleDrag, setHandleDrag] = useState<{
    source_id: string;
    origin: { x: number; y: number };
    mouse: { x: number; y: number };
  } | null>(null);
  const handleDragRef = useRef(handleDrag);
  useEffect(() => { handleDragRef.current = handleDrag; }, [handleDrag]);

  // 다중 선택 (marquee + 모바일 롱프레스)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectRect, setSelectRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const selectDrag = useRef<{ startX: number; startY: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** zoom=1 → 100%, contentBox = 노드 범위 기준 viewBox. */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  /** 노드 수동 위치 오프셋 (자동 레이아웃 대비 delta). */
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const layoutDir: LayoutDir = compute_layout_dir(workflow.phases);
  const nodeDrag = useRef<{ id: string; startSvg: { x: number; y: number }; startOffset: { dx: number; dy: number }; moved: boolean; isTouch?: boolean } | null>(null);
  const DRAG_THRESHOLD = 5;
  const TOUCH_DRAG_THRESHOLD = 12;

  const autoPositions = compute_positions(workflow.phases, workflow, layoutDir);
  /** 보조 노드 + 위치 계산. */
  const auxData = compute_aux_positions(workflow, autoPositions, layoutDir);
  /** 자동 레이아웃 + 수동 오프셋 합산 (Phase + 보조 노드 모두 포함). */
  const positions = (() => {
    const merged = new Map<string, NodePos>();
    for (const [id, pos] of autoPositions) {
      const off = nodeOffsets[id];
      merged.set(id, off ? { ...pos, x: pos.x + off.dx, y: pos.y + off.dy } : pos);
    }
    for (const [id, pos] of auxData.positions) {
      const off = nodeOffsets[id];
      merged.set(id, off ? { ...pos, x: pos.x + off.dx, y: pos.y + off.dy } : pos);
    }
    return merged;
  })();
  const edges = [
    ...compute_edges(workflow.phases),
    ...compute_aux_edges(workflow),
  ];

  /** SVG 엘리먼트 실제 크기 추적 (viewBox를 콘텐츠가 아닌 뷰포트 기준으로). */
  const [svgSize, setSvgSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSvgSize({ w: entry.contentRect.width || 800, h: entry.contentRect.height || 600 });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  /** 노드 전체 범위 (fit-to-content 리셋용). */
  const contentBox = (() => {
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (const pos of positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height);
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 400, h: 300 };
    const OVERLAY_BOTTOM = 60; // 좌하단 줌 오버레이 여유 공간
    return {
      x: minX - PADDING,
      y: minY - PADDING,
      w: maxX - minX + PADDING * 2,
      h: maxY - minY + PADDING + OVERLAY_BOTTOM,
    };
  })();

  /** zoom + pan 적용된 viewBox — SVG 엘리먼트 크기 기준 (콘텐츠 무관). */
  const viewBox = {
    x: pan.x,
    y: pan.y,
    w: svgSize.w / zoom,
    h: svgSize.h / zoom,
  };

  /** SVG 좌표 변환 (useEffect 내에서도 안전하게 사용 가능). */
  const svgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM()?.inverse();
    if (!ctm) return { x: clientX, y: clientY };
    const svgPt = pt.matrixTransform(ctm);
    return { x: svgPt.x, y: svgPt.y };
  };
  const svgPointRef = useRef(svgPoint);

  /** 노드 드래그 시작. */
  const handleNodeDragStart = (phase_id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const pt = svgPoint(e.clientX, e.clientY);
    const off = nodeOffsets[phase_id] || { dx: 0, dy: 0 };
    nodeDrag.current = { id: phase_id, startSvg: pt, startOffset: off, moved: false };
  };

  /** 노드 터치 드래그 시작 + 롱프레스 다중 선택. */
  const handleNodeTouchStart = (phase_id: string, touch: { clientX: number; clientY: number }) => {
    if (multiSelectMode) {
      // 다중 선택 모드에서 탭 → 토글
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(phase_id)) next.delete(phase_id); else next.add(phase_id);
        return next;
      });
      return;
    }
    const pt = svgPoint(touch.clientX, touch.clientY);
    const off = nodeOffsets[phase_id] || { dx: 0, dy: 0 };
    nodeDrag.current = { id: phase_id, startSvg: pt, startOffset: off, moved: false, isTouch: true };
    // 롱프레스 → 다중 선택 모드 진입
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      nodeDrag.current = null; // 드래그 취소
      setMultiSelectMode(true);
      setMultiSelected(new Set([phase_id]));
    }, 500);
  };

  const portDragStartRef = useRef<(nodeId: string, portName: string) => void>(undefined);
  /** 출력 포트 드래그 시작 (단일 포트 — 항상 노드 중앙). */
  const handlePortDragStart = (nodeId: string, portName: string) => {
    const pos = positions.get(nodeId);
    if (!pos) return;
    const fy = pos.height / 2;
    setDrag({ from_id: nodeId, from_port: portName, mouse: { x: pos.x + pos.width, y: pos.y + fy } });
  };
  /** 휠 이벤트 — Ctrl/Meta+Wheel: 줌, 일반 Wheel: 팬 (트랙패드 친화). */
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Wheel 또는 트랙패드 핀치 → 줌 (피벗 기반)
      const pivot = svgPointRef.current(e.clientX, e.clientY);
      setZoom((prev) => {
        const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
        const scale = next / prev;
        setPan((p) => ({
          x: pivot.x - (pivot.x - p.x) / scale,
          y: pivot.y - (pivot.y - p.y) / scale,
        }));
        return next;
      });
    } else {
      // 일반 Wheel / 트랙패드 두 손가락 스크롤 → 팬
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = (svgSize.w / zoom) / rect.width;
      const scaleY = (svgSize.h / zoom) / rect.height;
      setPan((p) => ({
        x: p.x + e.deltaX * scaleX,
        y: p.y + e.deltaY * scaleY,
      }));
    }
  };
  const wheelHandler = useRef<(e: WheelEvent) => void>(handleWheel);
  /** ref 래핑 — 터치 핸들러에서 stale closure 방지. */
  const mouseUpRef = useRef<() => void>(undefined);

  /** 터치 상태 (핀치 줌 + 원터치 팬). */
  const touchState = useRef<{ lastDist: number; lastCenter: { x: number; y: number }; fingers: number; portDrag: boolean }>({
    lastDist: 0, lastCenter: { x: 0, y: 0 }, fingers: 0, portDrag: false,
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // 휠 줌
    const onWheel = (e: WheelEvent) => wheelHandler.current?.(e);
    svg.addEventListener("wheel", onWheel, { passive: false });

    // 터치 핸들러
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        touchState.current = {
          lastDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          lastCenter: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
          fingers: 2, portDrag: false,
        };
      } else if (e.touches.length === 1) {
        // 포트 터치 → 포트 드래그 시작
        const portEl = (e.target as Element).closest(".graph-port--field, .graph-port--out");
        if (portEl) {
          e.preventDefault();
          const nodeEl = portEl.closest("[data-node-id]") as Element | null;
          const nodeId = nodeEl?.getAttribute("data-node-id");
          const portName = portEl.getAttribute("data-port-name");
          if (nodeId && portName) {
            touchState.current = { lastDist: 0, lastCenter: { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }, fingers: 1, portDrag: true };
            portDragStartRef.current?.(nodeId, portName);
            return;
          }
        }
        touchState.current = {
          lastDist: 0,
          lastCenter: { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY },
          fingers: 1, portDrag: false,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // 롱프레스 타이머 취소 (이동 시작하면 롱프레스 아님)
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      // AddHandle 터치 드래그
      if (handleDragRef.current && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0]!;
        const sp = svgPointRef.current(touch.clientX, touch.clientY);
        setHandleDrag((prev) => prev ? { ...prev, mouse: sp } : null);
        return;
      }
      // 포트 터치 드래그 (엣지 연결)
      if (touchState.current.portDrag && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0]!;
        const sp = svgPointRef.current(touch.clientX, touch.clientY);
        setDrag((prev) => prev ? { ...prev, mouse: sp } : prev);
        return;
      }
      // 노드 터치 드래그
      const nd = nodeDrag.current;
      if (nd && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0]!;
        const pt = svgPointRef.current(touch.clientX, touch.clientY);
        const dx = pt.x - nd.startSvg.x;
        const dy = pt.y - nd.startSvg.y;
        if (!nd.moved && Math.hypot(dx, dy) < TOUCH_DRAG_THRESHOLD) return;
        nd.moved = true;
        setNodeOffsets((prev) => ({
          ...prev,
          [nd.id]: { dx: nd.startOffset.dx + dx, dy: nd.startOffset.dy + dy },
        }));
        return;
      }

      const ts = touchState.current;
      if (e.touches.length === 2 && ts.fingers === 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const ratio = dist / (ts.lastDist || 1);
        // 핀치 중심을 피벗으로 줌 + 팬 보정
        const cx = (a.clientX + b.clientX) / 2;
        const cy = (a.clientY + b.clientY) / 2;
        const pivotSvg = svgPointRef.current(cx, cy);
        setZoom((prev) => {
          const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * ratio));
          const scale = next / prev;
          setPan((p) => ({
            x: pivotSvg.x - (pivotSvg.x - p.x) / scale,
            y: pivotSvg.y - (pivotSvg.y - p.y) / scale,
          }));
          return next;
        });
        ts.lastDist = dist;
      } else if (e.touches.length === 1 && ts.fingers === 1) {
        const dx = e.touches[0]!.clientX - ts.lastCenter.x;
        const dy = e.touches[0]!.clientY - ts.lastCenter.y;
        const rect = svg.getBoundingClientRect();
        const cw = svg.viewBox.baseVal.width;
        const ch = svg.viewBox.baseVal.height;
        setPan((p) => ({
          x: p.x - dx * (cw / rect.width),
          y: p.y - dy * (ch / rect.height),
        }));
        ts.lastCenter = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      }
    };

    const onTouchEnd = () => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      // AddHandle 터치 드래그 완료
      const hd = handleDragRef.current;
      if (hd) {
        const dist = Math.hypot(hd.mouse.x - hd.origin.x, hd.mouse.y - hd.origin.y);
        if (dist > 10) {
          setPickerSource({ type: "handle", source_id: hd.source_id });
          setPickerDropPos(hd.mouse);
          setPickerOpen(true);
        }
        setHandleDrag(null);
        return;
      }
      if (touchState.current.portDrag) {
        touchState.current.portDrag = false;
        mouseUpRef.current?.();
      }
      touchState.current.fingers = 0;
      nodeDrag.current = null;
    };

    svg.addEventListener("touchstart", onTouchStart, { passive: false });
    svg.addEventListener("touchmove", onTouchMove, { passive: false });
    svg.addEventListener("touchend", onTouchEnd);

    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("touchstart", onTouchStart);
      svg.removeEventListener("touchmove", onTouchMove);
      svg.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  /** 캔버스 팬: 빈 영역 좌클릭 또는 중간 버튼 어디서든 드래그. */
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // 중간 버튼(wheel click) → 어디서든 팬 시작
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    if (drag) return; // 포트 드래그 중이면 무시
    const isOnNode = (e.target as Element).closest(".graph-port, .graph-node, .graph-play-btn, .graph-add-handle, .graph-edge-add");
    if (isOnNode) return;
    // Shift+드래그 → marquee 선택
    if (e.shiftKey) {
      const pt = svgPoint(e.clientX, e.clientY);
      selectDrag.current = { startX: pt.x, startY: pt.y };
      setMultiSelected(new Set());
      return;
    }
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  /** 드래그 중 마우스 이동 (노드 드래그 + 캔버스 팬 + 포트 드래그 + marquee + AddHandle 드래그). */
  const handleMouseMove = (e: React.MouseEvent) => {
    // AddHandle 드래그
    if (handleDrag) {
      const pt = svgPoint(e.clientX, e.clientY);
      setHandleDrag((prev) => prev ? { ...prev, mouse: pt } : null);
      return;
    }
    // Marquee 선택 드래그
    if (selectDrag.current) {
      const pt = svgPoint(e.clientX, e.clientY);
      const { startX, startY } = selectDrag.current;
      setSelectRect({
        x: Math.min(startX, pt.x), y: Math.min(startY, pt.y),
        w: Math.abs(pt.x - startX), h: Math.abs(pt.y - startY),
      });
      return;
    }
    // 노드 드래그
    const nd = nodeDrag.current;
    if (nd) {
      const pt = svgPoint(e.clientX, e.clientY);
      const dx = pt.x - nd.startSvg.x;
      const dy = pt.y - nd.startSvg.y;
      if (!nd.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      nd.moved = true;
      setNodeOffsets((prev) => ({
        ...prev,
        [nd.id]: { dx: nd.startOffset.dx + dx, dy: nd.startOffset.dy + dy },
      }));
      return;
    }
    // 캔버스 팬
    if (isPanning) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      setPan({
        x: panStart.current.panX - (e.clientX - panStart.current.x) * scaleX,
        y: panStart.current.panY - (e.clientY - panStart.current.y) * scaleY,
      });
      return;
    }
    // 포트 드래그
    if (!drag) return;
    const pt = svgPoint(e.clientX, e.clientY);
    setDrag({ ...drag, mouse: pt });
  };

  /** 드롭: 노드 드래그 종료 + 대상 노드 위에서 마우스 업 + 팬 종료 + marquee 완료 + AddHandle 드롭. */
  const handleMouseUp = () => {
    // AddHandle 드래그 완료 → 드롭 위치에 NodePicker 열기
    if (handleDrag) {
      const dropSvg = handleDrag.mouse;
      const dist = Math.hypot(dropSvg.x - handleDrag.origin.x, dropSvg.y - handleDrag.origin.y);
      if (dist > 10) {
        setPickerSource({ type: "handle", source_id: handleDrag.source_id });
        setPickerDropPos(dropSvg);
        setPickerOpen(true);
      }
      setHandleDrag(null);
      return;
    }
    // Marquee 선택 완료
    if (selectDrag.current) {
      if (selectRect) {
        const selected = new Set<string>();
        for (const [id, pos] of positions) {
          // 사각형 겹침 판정
          if (pos.x + pos.width > selectRect.x && pos.x < selectRect.x + selectRect.w &&
              pos.y + pos.height > selectRect.y && pos.y < selectRect.y + selectRect.h) {
            selected.add(id);
          }
        }
        setMultiSelected(selected);
      }
      setSelectRect(null);
      selectDrag.current = null;
      return;
    }
    if (nodeDrag.current) {
      const wasDrag = nodeDrag.current.moved;
      nodeDrag.current = null;
      if (wasDrag) return; // 드래그였으면 클릭 이벤트 방지
    }
    if (isPanning) { setIsPanning(false); return; }
    if (!drag) return;

    // 모든 노드의 모든 입력 포트 위치를 계산하여 가장 가까운 포트 탐지
    let target_id: string | null = null;
    let target_port: string | null = null;
    let min_dist = 30;

    for (const [id, pos] of positions) {
      if (id === drag.from_id) continue;
      // 단일 입력 포트: 좌측 중앙
      const dist = Math.hypot(drag.mouse.x - pos.x, drag.mouse.y - (pos.y + pos.height / 2));
      if (dist < min_dist) {
        min_dist = dist;
        target_id = id;
        target_port = "input";
      }
    }

    if (target_id) {
      // field_mappings에 추가 + depends_on 자동 설정
      const mappings = [...(workflow.field_mappings || [])];
      mappings.push({
        from_node: drag.from_id,
        from_field: drag.from_port,
        to_node: target_id,
        to_field: target_port || "",
      });
      const updates: Partial<WorkflowDef> = { field_mappings: mappings };

      // 타겟이 오케 노드면 depends_on에 소스 추가
      const orche_nodes = (workflow.orche_nodes || []).map((n) => ({ ...n }));
      const target_orche = orche_nodes.find((n) => n.node_id === target_id);
      if (target_orche) {
        const deps = new Set((target_orche.depends_on as string[] | undefined) || []);
        deps.add(drag.from_id);
        target_orche.depends_on = [...deps];
        updates.orche_nodes = orche_nodes;
      }
      // 타겟이 Phase면 depends_on에 소스 추가
      const phases = workflow.phases.map((p) => ({ ...p }));
      const target_phase = phases.find((p) => p.phase_id === target_id);
      if (target_phase) {
        const deps = new Set(target_phase.depends_on || []);
        deps.add(drag.from_id);
        target_phase.depends_on = [...deps];
        updates.phases = phases;
      }
      onChange({ ...workflow, ...updates });
    }
    setDrag(null);
  };
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  // 렌더마다 최신 함수로 refs 갱신 — 이벤트 핸들러의 stale closure 방지
  useEffect(() => {
    svgPointRef.current = svgPoint;
    portDragStartRef.current = handlePortDragStart;
    wheelHandler.current = handleWheel;
    mouseUpRef.current = handleMouseUp;
  });

  const addPhase = () => {
    const idx = workflow.phases.length;
    const newPhase: PhaseDef = {
      phase_id: `phase-${idx + 1}`,
      title: `Phase ${idx + 1}`,
      agents: [{ agent_id: `agent-1`, role: "", label: "", backend: "", system_prompt: "", max_turns: 3 }],
    };
    if (idx > 0) {
      newPhase.depends_on = [workflow.phases[idx - 1]!.phase_id];
    }
    onChange({ ...workflow, phases: [...workflow.phases, newPhase] });
  };

  /** NodePicker 열기: 노드 핸들에서. */
  const openPickerFromHandle = (source_id: string) => {
    setPickerSource({ type: "handle", source_id });
    setPickerOpen(true);
  };

  /** NodePicker 열기: 엣지 중간 삽입. */
  const openPickerForEdge = (from_id: string, to_id: string) => {
    setPickerSource({ type: "edge", from_id, to_id });
    setPickerOpen(true);
  };

  /** NodePicker 선택 핸들러: 노드 생성 + 자동 연결. */
  const handlePickerSelect = (node_type: string, preset?: NodePreset) => {
    // 특수 타입: Phase
    if (node_type === "__phase__") {
      addPhase();
      setPickerOpen(false);
      setPickerSource(null);
      return;
    }
    // 특수 타입: Trigger
    const triggerMatch = node_type.match(/^__trigger_(\w+)__$/);
    if (triggerMatch) {
      addTriggerNode(triggerMatch[1] as TriggerType);
      setPickerOpen(false);
      setPickerSource(null);
      return;
    }

    // 특수 타입: End (Output) — 복수 인스턴스 가능 (__end__: NodePicker 특수 ID)
    if (node_type === "end" || node_type === "__end__") {
      const existing_ends = workflow.end_nodes || [];
      const idx = existing_ends.length + 1;
      const newEnd: EndNodeDef = {
        node_id: `end-${idx}`,
        output_targets: [],
        depends_on: pickerSource?.type === "handle" ? [pickerSource.source_id] : undefined,
      };
      onChange({ ...workflow, end_nodes: [...existing_ends, newEnd] });
      setPickerOpen(false);
      setPickerSource(null);
      return;
    }

    const desc = get_frontend_node(node_type);
    if (!desc) { setPickerOpen(false); return; }
    const existing = workflow.orche_nodes || [];
    const idx = existing.length + 1;
    const defaults = preset ? preset.defaults : desc.create_default();
    const label = preset ? preset.label : t(desc.toolbar_label);
    const node_id = `${node_type}-${idx}`;
    const newNode: OrcheNodeDef = {
      node_id,
      node_type: node_type as OrcheNodeDef["node_type"],
      title: `${label} ${idx}`,
      ...defaults,
    } as OrcheNodeDef;

    let updatedOrche = [...existing, newNode];
    let updatedPhases = workflow.phases;

    if (pickerSource?.type === "handle") {
      newNode.depends_on = [pickerSource.source_id];
    } else if (pickerSource?.type === "edge") {
      const { from_id, to_id } = pickerSource;
      newNode.depends_on = [from_id];
      updatedOrche = updatedOrche.map((n) => {
        if (n.node_id !== to_id) return n;
        const deps = ((n.depends_on as string[]) || []).map((d) => d === from_id ? node_id : d);
        return { ...n, depends_on: deps };
      });
      updatedPhases = workflow.phases.map((p) => {
        if (p.phase_id !== to_id) return p;
        const deps = (p.depends_on || []).map((d) => d === from_id ? node_id : d);
        return { ...p, depends_on: deps };
      });
    }

    // 드롭 위치에 노드 배치: 레이아웃 자동 위치와 드롭 좌표 차이를 오프셋으로 적용
    if (pickerDropPos) {
      const updatedWorkflow = { ...workflow, phases: updatedPhases, orche_nodes: updatedOrche };
      const newAutoPositions = compute_positions(updatedPhases, updatedWorkflow);
      const newAuxData = compute_aux_positions(updatedWorkflow, newAutoPositions);
      const layoutPos = newAutoPositions.get(node_id) ?? newAuxData.positions.get(node_id);
      if (layoutPos) {
        const dx = pickerDropPos.x - layoutPos.x;
        const dy = pickerDropPos.y - layoutPos.y;
        setNodeOffsets((prev) => ({ ...prev, [node_id]: { dx, dy } }));
      }
    }

    onChange({ ...workflow, phases: updatedPhases, orche_nodes: updatedOrche });
    setPickerOpen(false);
    setPickerSource(null);
    setPickerDropPos(null);
  };

  /** 그룹 생성: 다중 선택된 노드로. */
  const createGroup = () => {
    if (multiSelected.size < 2) return;
    const groups = [...(workflow.groups || [])];
    const group_id = `group-${groups.length + 1}`;
    const COLORS = ["#3498db", "#e91e63", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];
    groups.push({
      group_id,
      label: `Group ${groups.length + 1}`,
      color: COLORS[groups.length % COLORS.length]!,
      node_ids: [...multiSelected],
    });
    onChange({ ...workflow, groups });
    setMultiSelected(new Set());
    setMultiSelectMode(false);
  };

  /** 그룹 업데이트. */
  const updateGroup = (group_id: string, patch: Partial<NodeGroup>) => {
    const groups = (workflow.groups || []).map((g) =>
      g.group_id === group_id ? { ...g, ...patch } : g
    );
    onChange({ ...workflow, groups });
  };

  /** 그룹 삭제 (노드 유지, 프레임만 제거). */
  const deleteGroup = (group_id: string) => {
    const groups = (workflow.groups || []).filter((g) => g.group_id !== group_id);
    onChange({ ...workflow, groups });
  };

  const addTriggerNode = (trigger_type: TriggerType) => {
    const existing = workflow.trigger_nodes || [];
    const idx = existing.length + 1;
    const node: TriggerNodeDef = { id: `trigger-${idx}`, trigger_type };
    if (trigger_type === "cron") node.schedule = "0 9 * * *";
    onChange({ ...workflow, trigger_nodes: [...existing, node] });
  };

  /** 드래그 시작점 좌표: 출력 포트 위치 (단일 포트 — 항상 중앙). */
  const dragStartPos = (() => {
    if (!drag) return null;
    const pos = positions.get(drag.from_id);
    if (!pos) return null;
    return { x: pos.x + pos.width, y: pos.y + pos.height / 2 };
  })();

  /** 피벗 기반 줌: 선택된 노드 중심 또는 뷰포트 중심. */
  const zoomTo = (dir: 1 | -1) => {
    setZoom((prev) => {
      const factor = dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
      if (next === prev) return prev;
      const selPos = selectedPhaseId ? positions.get(selectedPhaseId) : null;
      const pivot = selPos
        ? { x: selPos.x + selPos.width / 2, y: selPos.y + selPos.height / 2 }
        : { x: pan.x + svgSize.w / prev / 2, y: pan.y + svgSize.h / prev / 2 };
      const scale = next / prev;
      setPan((p) => ({
        x: pivot.x - (pivot.x - p.x) / scale,
        y: pivot.y - (pivot.y - p.y) / scale,
      }));
      return next;
    });
  };
  const zoomIn = () => zoomTo(1);
  const zoomOut = () => zoomTo(-1);
  /** 현재 뷰포트 중심 좌표 (SVG 월드 기준) — 노드 피커 버튼 클릭 시 배치 기준점. */
  const viewport_center = () => ({ x: pan.x + svgSize.w / zoom / 2, y: pan.y + svgSize.h / zoom / 2 });
  /** Fit-to-content 리셋: 모든 노드가 보이도록 줌+팬 조정. */
  const zoomReset = () => {
    const zx = svgSize.w / contentBox.w;
    const zy = svgSize.h / contentBox.h;
    const fitZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(zx, zy) * 0.9));
    setZoom(fitZoom);
    setPan({ x: contentBox.x, y: contentBox.y });
  };

  /** 엣지 삭제: flow → depends_on 제거, mapping → field_mappings 제거. */
  const deleteEdge = (edge: Edge) => {
    if (edge.type === "flow") {
      const phases = workflow.phases.map((p) => {
        if (p.phase_id !== edge.to) return p;
        return { ...p, depends_on: (p.depends_on || []).filter((d) => d !== edge.from) };
      });
      const orche = (workflow.orche_nodes || []).map((n) => {
        if (n.node_id !== edge.to) return n;
        return { ...n, depends_on: ((n.depends_on as string[]) || []).filter((d) => d !== edge.from) };
      });
      onChange({ ...workflow, phases, orche_nodes: orche });
    } else if (edge.type === "mapping") {
      const mappings = (workflow.field_mappings || []).filter(
        (m) => !(m.from_node === edge.from && m.to_node === edge.to && m.from_field === (edge.from_port || "") && m.to_field === (edge.to_port || ""))
      );
      onChange({ ...workflow, field_mappings: mappings });
    }
  };

  /** 우클릭 컨텍스트 메뉴 열기. */
  const handleContextMenu = (e: React.MouseEvent) => {
    const nodeEl = (e.target as Element).closest(".graph-node");
    if (!nodeEl) { setCtxMenu(null); return; }
    e.preventDefault();
    const nodeId = nodeEl.getAttribute("data-node-id");
    if (nodeId) {
      onSelectPhase(nodeId);
      setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
    }
  };

  /** 노드 삭제 (ID 기반). */
  const deleteNode = (id: string) => {
    // End 노드 삭제
    if ((workflow.end_nodes || []).some((en) => en.node_id === id)) {
      onChange({ ...workflow, end_nodes: (workflow.end_nodes || []).filter((en) => en.node_id !== id) });
      onSelectPhase(null);
      return;
    }
    const isPhase = workflow.phases.some((p) => p.phase_id === id);
    if (isPhase) {
      const phases = workflow.phases.filter((p) => p.phase_id !== id)
        .map((p) => ({ ...p, depends_on: p.depends_on?.filter((d) => d !== id) }));
      onChange({ ...workflow, phases });
    } else {
      onChange({
        ...workflow,
        orche_nodes: (workflow.orche_nodes || []).filter((n) => n.node_id !== id),
        trigger_nodes: (workflow.trigger_nodes || []).filter((n) => n.id !== id),
        tool_nodes: (workflow.tool_nodes || []).filter((n) => n.id !== id),
        skill_nodes: (workflow.skill_nodes || []).filter((n) => n.id !== id),
      });
    }
    onSelectPhase(null);
  };

  // 키보드 핸들러 ref 갱신 — 선언 완료 후 위치에서 최신 클로저 유지
  useEffect(() => {
    keyHandlerRef.current = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 50);
        return;
      }
      if (e.key === "Escape" && searchOpen) { setSearchOpen(false); setSearchQuery(""); return; }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") { onSelectPhase(null); return; }
      if (e.key === "=" || e.key === "+") { zoomIn(); return; }
      if (e.key === "-") { zoomOut(); return; }
      if (e.key === "0") { zoomReset(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPhaseId) {
        confirmAction(t("workflows.remove_confirm"), () => deleteNode(selectedPhaseId));
      }
    };
  });

  /** 컨텍스트 메뉴: 노드 삭제. */
  const ctxDelete = () => {
    if (!ctxMenu) return;
    deleteNode(ctxMenu.nodeId);
    setCtxMenu(null);
  };

  /** 노드 복제 (ID 기반). */
  const duplicateNode = (id: string) => {
    const phase = workflow.phases.find((p) => p.phase_id === id);
    if (phase) {
      const idx = workflow.phases.length + 1;
      const clone: PhaseDef = {
        ...JSON.parse(JSON.stringify(phase)),
        phase_id: `phase-${idx}`,
        title: `${phase.title} (copy)`,
        depends_on: phase.depends_on ? [...phase.depends_on] : undefined,
      };
      clone.agents = clone.agents.map((a, i) => ({ ...a, agent_id: `agent-${i + 1}` }));
      onChange({ ...workflow, phases: [...workflow.phases, clone] });
    } else {
      const orche = workflow.orche_nodes?.find((n) => n.node_id === id);
      if (orche) {
        const idx = (workflow.orche_nodes?.length || 0) + 1;
        const clone = { ...JSON.parse(JSON.stringify(orche)), node_id: `${orche.node_type}-${idx}`, title: `${orche.title} (copy)` };
        onChange({ ...workflow, orche_nodes: [...(workflow.orche_nodes || []), clone] });
      }
    }
  };

  /** 컨텍스트 메뉴: 노드 복제. */
  const ctxDuplicate = () => {
    if (!ctxMenu) return;
    duplicateNode(ctxMenu.nodeId);
    setCtxMenu(null);
  };

  /** Aggregator: depends_on >= 2인 노드 앞에 다이아몬드 합류점 표시. */
  const aggregators = (() => {
    const result: { x: number; y: number; phase_id: string }[] = [];
    for (const phase of workflow.phases) {
      if (!phase.depends_on || phase.depends_on.length < 2) continue;
      const pos = positions.get(phase.phase_id);
      if (!pos) continue;
      result.push({ x: pos.x - 16, y: pos.y + pos.height / 2, phase_id: phase.phase_id });
    }
    return result;
  })();

  /** 검색 결과: 매칭 노드 ID 목록. */
  const searchResults = (() => {
    if (!searchQuery.trim()) return [] as string[];
    const q = searchQuery.toLowerCase();
    const ids: string[] = [];
    // Phase 노드
    for (const p of workflow.phases) {
      if (p.phase_id.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) ids.push(p.phase_id);
    }
    // 보조 노드 (오케/트리거/채널 등)
    for (const n of auxData.nodes) {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || n.type.toLowerCase().includes(q)) {
        ids.push(n.id);
      }
    }
    return ids;
  })();

  /** 검색 결과 선택 시 해당 노드로 팬 이동. */
  const focusNode = (nodeId: string) => {
    const pos = positions.get(nodeId);
    if (!pos) return;
    const cx = pos.x + pos.width / 2;
    const cy = pos.y + pos.height / 2;
    setPan({ x: cx - svgSize.w / zoom / 2, y: cy - svgSize.h / zoom / 2 });
    onSelectPhase(nodeId);
  };

  /** 키보드 단축키 — stable listener가 ref를 통해 최신 핸들러 호출. */
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current?.(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="graph-editor">
      <svg
        ref={svgRef}
        className={`graph-editor__canvas${isPanning ? " graph-editor__canvas--panning" : ""}`}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={(e) => { setCtxMenu(null); handleCanvasMouseDown(e); }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDrag(null); setHandleDrag(null); setIsPanning(false); nodeDrag.current = null; selectDrag.current = null; setSelectRect(null); }}
        onContextMenu={handleContextMenu}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest(".graph-node")) addPhase();
        }}
      >
        <defs>
          {/* 노드 드롭 섀도우 (이중 레이어) */}
          <filter id="node-shadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.15" />
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.08" />
          </filter>
          {/* 노드 accent 글로우 (선택/hover 시) */}
          <filter id="node-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.29  0 0 0 0 0.62  0 0 0 0 1  0 0 0 0.3 0" result="glow" />
            <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* 도트 그리드 배경 */}
          <pattern id="grid-dots" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="10" cy="10" r="0.7" fill="var(--canvas-dot, rgba(255,255,255,0.04))" />
          </pattern>
          <pattern id="grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="url(#grid-dots)" />
            <circle cx="0" cy="0" r="1" fill="var(--canvas-dot-major, rgba(255,255,255,0.08))" />
          </pattern>
          <marker id="arrow-flow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-flow, var(--line, #555))" />
          </marker>
          <marker id="arrow-goto" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-goto, var(--err, #e74c3c))" />
          </marker>
          <marker id="arrow-attach" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-attach, var(--muted, #6c7086))" />
          </marker>
          <marker id="arrow-trigger" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-trigger, #e67e22)" />
          </marker>
          <marker id="arrow-config" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--warn, #f1c40f)" />
          </marker>
          <marker id="arrow-mapping" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-mapping, #9b59b6)" />
          </marker>
          <style>{`
            @keyframes node-pulse {
              0%, 100% { opacity: 0.3; stroke-width: 2; }
              50% { opacity: 0.8; stroke-width: 3; }
            }
            .node-running-glow {
              animation: node-pulse 1.5s ease-in-out infinite;
            }
          `}</style>
        </defs>

        {/* 도트 그리드 배경 */}
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="url(#grid-major)" />

        {/* 그룹 프레임 (노드보다 뒤에 렌더링) */}
        {(workflow.groups || []).map((group) => (
          <GroupFrame
            key={group.group_id}
            group={group}
            positions={positions}
            onUpdate={(patch) => updateGroup(group.group_id, patch)}
            onDelete={() => deleteGroup(group.group_id)}
            onToggleCollapse={() => updateGroup(group.group_id, { collapsed: !group.collapsed })}
          />
        ))}

        {/* Edges */}
        {edges.map((edge, i) => (
          <EdgePath key={`${edge.from}-${edge.to}-${i}`} {...edge} positions={positions}
            onDelete={(edge.type === "flow" || edge.type === "mapping") ? () => deleteEdge(edge) : undefined}
            onInsert={edge.type === "flow" ? openPickerForEdge : undefined}
            graphNodes={auxData.nodes} phases={workflow.phases}
          />
        ))}

        {/* Aggregator 다이아몬드 (Fork-Join 합류점) */}
        {aggregators.map((agg) => (
          <g key={`agg-${agg.phase_id}`} transform={`translate(${agg.x}, ${agg.y})`}>
            <polygon
              points="0,-8 8,0 0,8 -8,0"
              fill="var(--accent, #89b4fa)"
              opacity={0.3}
              stroke="var(--accent, #89b4fa)"
              strokeWidth={1.5}
            />
          </g>
        ))}

        {/* 드래그 중인 선 미리보기 */}
        {drag && dragStartPos && (
          <line
            x1={dragStartPos.x}
            y1={dragStartPos.y}
            x2={drag.mouse.x}
            y2={drag.mouse.y}
            stroke="var(--edge-mapping, #9b59b6)"
            strokeWidth={2}
            strokeDasharray="4 3"
            opacity={0.7}
            pointerEvents="none"
          />
        )}

        {/* AddHandle 드래그 연결선 + 드롭 위치 인디케이터 */}
        {handleDrag && (() => {
          const { origin, mouse } = handleDrag;
          const dx = mouse.x - origin.x;
          const cpOffset = Math.max(40, Math.abs(dx) * 0.5);
          return (
            <g pointerEvents="none">
              <path
                d={`M ${origin.x} ${origin.y} C ${origin.x + cpOffset} ${origin.y}, ${mouse.x - cpOffset} ${mouse.y}, ${mouse.x} ${mouse.y}`}
                fill="none" stroke="var(--accent, #89b4fa)" strokeWidth={2} strokeDasharray="6 3" opacity={0.8}
              />
              <circle cx={mouse.x} cy={mouse.y} r={14} fill="var(--accent, #89b4fa)" fillOpacity={0.15} stroke="var(--accent, #89b4fa)" strokeWidth={1.5} />
              <text x={mouse.x} y={mouse.y} textAnchor="middle" dominantBaseline="central" fontSize={14} fill="var(--accent, #89b4fa)">+</text>
            </g>
          );
        })()}

        {/* Phase Nodes + AddHandle */}
        {workflow.phases.map((phase) => {
          const pos = positions.get(phase.phase_id);
          if (!pos) return null;
          return (
            <g key={phase.phase_id}>
              <PhaseNode
                phase={phase}
                pos={pos}
                isSelected={selectedPhaseId === phase.phase_id}
                isRunning={runningNodeId === phase.phase_id}
                onClick={() => {
                  if (multiSelectMode) {
                    setMultiSelected((prev) => { const n = new Set(prev); if (n.has(phase.phase_id)) n.delete(phase.phase_id); else n.add(phase.phase_id); return n; });
                  } else {
                    onSelectPhase(selectedPhaseId === phase.phase_id ? null : phase.phase_id);
                  }
                }}
                onDoubleClick={() => onEditPhase?.(phase.phase_id)}
                onPortDragStart={handlePortDragStart}
                onNodeDragStart={handleNodeDragStart}
                onNodeTouchStart={handleNodeTouchStart}
                subSlotCount={
                  phase.agents.length
                  + (phase.critic ? 1 : 0)
                  + (workflow.tool_nodes || []).filter((t) => t.attach_to?.includes(phase.phase_id)).length
                  + (workflow.skill_nodes || []).filter((s) => s.attach_to?.includes(phase.phase_id)).length
                }
              />
              <AddHandle pos={pos} onClick={() => openPickerFromHandle(phase.phase_id)}
                onDragStart={(origin) => setHandleDrag({ source_id: phase.phase_id, origin, mouse: origin })} />
            </g>
          );
        })}

        {/* Auxiliary Nodes (Tool/Skill/Cron/Channel) + AddHandle */}
        {auxData.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const isOrche = is_orche_type(node.type);
          return (
            <g key={node.id}>
              <AuxNode
                node={node}
                pos={pos}
                isRunning={runningNodeId === node.id}
                isSelected={selectedPhaseId === node.id}
                nodeStatus={orcheStates?.find((s) => s.node_id === node.id)?.status}
                onClick={(id) => {
                  if (multiSelectMode) {
                    setMultiSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
                  } else {
                    onSelectPhase(id);
                  }
                }}
                onDragStart={handleNodeDragStart}
                onTouchStart={handleNodeTouchStart}
                onDoubleClick={(id) => node.type === "sub_node" ? onEditSubNode?.(id) : onEditPhase?.(id)}
                onSubNodeClick={node.type === "sub_node" ? onEditSubNode : undefined}
                onFieldDragStart={(nodeId, fieldName) => handlePortDragStart(nodeId, fieldName)}
              />
              {(isOrche || node.type === "trigger") && node.type !== "end" && (
                <AddHandle pos={pos} onClick={() => openPickerFromHandle(node.id)}
                  onDragStart={(origin) => setHandleDrag({ source_id: node.id, origin, mouse: origin })} />
              )}
            </g>
          );
        })}

        {/* 선택 노드 상단 미니 액션 툴바 */}
        {selectedPhaseId && multiSelected.size < 2 && (() => {
          const selPos = positions.get(selectedPhaseId);
          if (!selPos) return null;
          const tbW = onRunNode ? 120 : 90;
          const tbH = 28;
          return (
            <foreignObject
              x={selPos.x + selPos.width / 2 - tbW / 2}
              y={selPos.y - tbH - 6}
              width={tbW} height={tbH}
              style={{ overflow: "visible" }}
            >
              <div className="graph-node-toolbar">
                <button title={t("workflows.edit")} aria-label={t("workflows.edit")} onClick={(e) => { e.stopPropagation(); onEditPhase?.(selectedPhaseId); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                {onRunNode && (
                  <button title={t("workflows.run_node")} aria-label={t("workflows.run_node")} onClick={(e) => { e.stopPropagation(); onRunNode(selectedPhaseId, "run"); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </button>
                )}
                <button title={t("workflows.duplicate")} aria-label={t("workflows.duplicate")} onClick={(e) => { e.stopPropagation(); duplicateNode(selectedPhaseId); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
                <button title={t("workflows.delete")} aria-label={t("workflows.delete")} className="graph-node-toolbar__danger" onClick={(e) => { e.stopPropagation(); confirmAction(t("workflows.remove_confirm"), () => deleteNode(selectedPhaseId)); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </div>
            </foreignObject>
          );
        })()}

        {/* Marquee 선택 사각형 */}
        {selectRect && (
          <rect
            x={selectRect.x} y={selectRect.y}
            width={selectRect.w} height={selectRect.h}
            fill="var(--accent, #89b4fa)" fillOpacity={0.1}
            stroke="var(--accent, #89b4fa)" strokeDasharray="4 2" strokeWidth={1}
            pointerEvents="none"
          />
        )}
      </svg>

      {/* 좌하단: 줌 컨트롤 + 미니맵 */}
      <div className="graph-editor__zoom-overlay">
        <button
          className="btn btn--sm btn--icon"
          onClick={() => { setNodeOffsets({}); zoomReset(); }}
          title={`오토 어레인지 (${layoutDir})`}
          aria-label="오토 어레인지"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </button>
        <button className="btn btn--sm btn--icon" onClick={zoomReset} title={t("workflows.zoom_fit")} aria-label={t("workflows.zoom_fit")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
        </button>
        <button className="btn btn--sm btn--icon" onClick={zoomOut} title={t("workflows.zoom_out")} aria-label={t("workflows.zoom_out")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <span className="graph-editor__zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="btn btn--sm btn--icon" onClick={zoomIn} title={t("workflows.zoom_in")} aria-label={t("workflows.zoom_in")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
      </div>

      {/* 미니맵 */}
      {positions.size > 0 && (() => {
        const MM_W = 160, MM_H = 100, MM_PAD = 8;
        const cw = contentBox.w || 1, ch = contentBox.h || 1;
        const scale = Math.min((MM_W - MM_PAD * 2) / cw, (MM_H - MM_PAD * 2) / ch);
        const ox = MM_PAD - contentBox.x * scale, oy = MM_PAD - contentBox.y * scale;
        // 뷰포트 영역
        const vx = ox + viewBox.x * scale, vy = oy + viewBox.y * scale;
        const vw = viewBox.w * scale, vh = viewBox.h * scale;
        return (
          <div className="graph-editor__minimap" aria-hidden="true"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = (e.clientX - rect.left - ox) / scale;
              const my = (e.clientY - rect.top - oy) / scale;
              setPan({ x: mx - viewBox.w / 2, y: my - viewBox.h / 2 });
            }}
          >
            <svg width={MM_W} height={MM_H} viewBox={`0 0 ${MM_W} ${MM_H}`}>
              {/* 노드 사각형 */}
              {[...positions.entries()].map(([id, p]) => {
                const phase = workflow.phases.find((ph) => ph.phase_id === id);
                const isPhaseNode = !!phase;
                return (
                  <rect
                    key={id}
                    x={ox + p.x * scale} y={oy + p.y * scale}
                    width={Math.max(2, p.width * scale)} height={Math.max(1, p.height * scale)}
                    fill={isPhaseNode ? "var(--accent, #89b4fa)" : "var(--muted, #6c7086)"}
                    opacity={selectedPhaseId === id ? 1 : 0.5}
                    rx={1}
                  />
                );
              })}
              {/* 뷰포트 영역 */}
              <rect x={vx} y={vy} width={vw} height={vh}
                fill="none" stroke="var(--accent, #89b4fa)" strokeWidth={1} opacity={0.8} rx={1}
              />
            </svg>
          </div>
        );
      })()}

      {/* 우상단: + 노드 추가 버튼 (검색 열린 동안 숨김) */}
      {!searchOpen && (
        <button
          className="graph-editor__add-btn"
          title={t("workflows.add_node")}
          onClick={() => { setPickerSource(null); setPickerDropPos(viewport_center()); setPickerOpen(true); }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      )}

      {/* 다중 선택 모드 바 */}
      {(multiSelectMode || multiSelected.size >= 2) && (
        <div className="graph-editor__multi-toolbar">
          <span>{multiSelected.size} {t("workflows.nodes_selected")}</span>
          {multiSelected.size >= 2 && (
            <button className="btn btn--sm btn--accent" onClick={createGroup}>
              {t("workflows.group_create")}
            </button>
          )}
          <button className="btn btn--sm" onClick={() => { setMultiSelected(new Set()); setMultiSelectMode(false); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* NodePicker 사이드 패널 */}
      <NodePicker
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); setPickerSource(null); setPickerDropPos(null); }}
        onSelect={handlePickerSelect}
        t={t}
      />

      {/* 빈 캔버스 안내 */}
      {workflow.phases.length === 0 && (
        <div className="graph-editor__empty">
          <div className="graph-editor__empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #89b4fa)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7"/><path d="M17.5 14v7"/></svg>
          </div>
          <p>{t("workflows.empty_canvas")}</p>
          <button
            className="btn btn--sm btn--accent"
            onClick={() => { setPickerSource(null); setPickerDropPos(viewport_center()); setPickerOpen(true); }}
          >
            + {t("workflows.empty_canvas_hint")}
          </button>
          <span className="graph-editor__empty-hint">{t("workflows.empty_canvas_dbl_click")}</span>
        </div>
      )}

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && (
        <>
          <div className="graph-ctx__backdrop" role="presentation" onClick={() => setCtxMenu(null)} />
          <div className="graph-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button className="graph-ctx__item" onClick={() => { onEditPhase?.(ctxMenu.nodeId); setCtxMenu(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {t("workflows.edit")}
            </button>
            {onRunNode && (
              <>
                <button className="graph-ctx__item" onClick={() => { onRunNode(ctxMenu.nodeId, "run"); setCtxMenu(null); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {t("workflows.run_node")}
                </button>
                <button className="graph-ctx__item" onClick={() => { onRunNode(ctxMenu.nodeId, "test"); setCtxMenu(null); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
                  {t("workflows.test_node")}
                </button>
              </>
            )}
            <button className="graph-ctx__item" onClick={ctxDuplicate}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              {t("workflows.duplicate")}
            </button>
            <button className="graph-ctx__item graph-ctx__item--danger" onClick={ctxDelete}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              {t("workflows.remove_phase")}
            </button>
          </div>
        </>
      )}

      {/* 노드 검색 오버레이 */}
      {searchOpen && (
        <div className="graph-editor__search">
          <SearchInput
            ref={searchRef}
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t("workflows.search_nodes")}
            onClear={() => { setSearchOpen(false); setSearchQuery(""); }}
            className="graph-editor__search-input"
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
              if (e.key === "Enter" && searchResults.length > 0) {
                focusNode(searchResults[0]!);
              }
            }}
          />
          {searchQuery && (
            <div className="graph-editor__search-results">
              {searchResults.length === 0 && <div className="graph-editor__search-empty">{t("workflows.no_search_results")}</div>}
              {searchResults.slice(0, 8).map((id) => {
                const phase = workflow.phases.find((p) => p.phase_id === id);
                const aux = auxData.nodes.find((n) => n.id === id);
                const label = phase?.title || aux?.label || id;
                const type = phase ? "phase" : aux?.type || "";
                const icon = phase ? (MODE_ICON[phase.mode || "parallel"] || "⚙") : (aux ? (orche_icon(aux.type) || "◆") : "");
                return (
                  <button key={id} className="graph-editor__search-item" onClick={() => { focusNode(id); setSearchOpen(false); setSearchQuery(""); }}>
                    <span className="graph-editor__search-icon">{icon}</span>
                    <span className="graph-editor__search-type">{type}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 하단 단축키 힌트 */}
      <div className="graph-editor__hints">
        <span>{t("workflows.hint_scroll")}</span>
        <span>{t("workflows.hint_zoom")}</span>
        <span>{t("workflows.hint_delete")}</span>
        <span>{t("workflows.hint_search")}</span>
        <span>{t("workflows.hint_select")}</span>
        <span>{t("workflows.hint_fit")}</span>
      </div>
      {confirmDialog}
    </div>
  );
}
