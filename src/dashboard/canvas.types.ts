/** Canvas (A2UI) — 에이전트가 웹 채팅에 렌더링하는 인터랙티브 UI 스펙. */

export interface CanvasSpec {
  canvas_id: string;
  title?: string;
  components: CanvasComponent[];
}

export type CanvasComponent =
  | CanvasTextComponent
  | CanvasMetricComponent
  | CanvasChartComponent
  | CanvasTableComponent
  | CanvasImageComponent
  | CanvasFormComponent
  | CanvasButtonComponent
  | CanvasDividerComponent;

export interface CanvasTextComponent {
  type: "text";
  content: string;
  variant?: "default" | "info" | "warn" | "error";
  heading?: 1 | 2 | 3;
}

export interface CanvasMetricComponent {
  type: "metric";
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  trend_up?: boolean;
}

export interface CanvasChartComponent {
  type: "chart";
  kind: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  datasets: { label: string; data: (number | string)[]; color?: string }[];
}

export interface CanvasTableComponent {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface CanvasImageComponent {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
}

export interface CanvasFormField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  default?: string;
  options?: string[];
}

export interface CanvasFormComponent {
  type: "form";
  title?: string;
  fields: CanvasFormField[];
  action_id?: string;
  submit_label?: string;
}

export interface CanvasButtonComponent {
  type: "button";
  label: string;
  action_id?: string;
  variant?: "primary" | "secondary" | "danger";
}

export interface CanvasDividerComponent {
  type: "divider";
}
