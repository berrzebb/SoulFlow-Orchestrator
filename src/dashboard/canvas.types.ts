/** Canvas (A2UI) — 에이전트가 웹 채팅에 렌더링하는 인터랙티브 UI 스펙. */

export type CanvasTextComponent = {
  type: "text";
  content: string;
  variant?: "default" | "info" | "warn" | "error";
  heading?: 1 | 2 | 3;
};

export type CanvasMetricComponent = {
  type: "metric";
  label: string;
  value: string;
  unit?: string;
  trend?: string;
  trend_up?: boolean;
};

export type CanvasChartDataset = {
  label: string;
  data: number[];
  color?: string;
};

export type CanvasChartComponent = {
  type: "chart";
  kind: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  datasets: CanvasChartDataset[];
};

export type CanvasTableComponent = {
  type: "table";
  columns: string[];
  rows: string[][];
  title?: string;
};

export type CanvasImageComponent = {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
};

export type CanvasFormField = {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox";
  options?: string[];
  default?: string;
  required?: boolean;
};

export type CanvasFormComponent = {
  type: "form";
  title?: string;
  fields: CanvasFormField[];
  submit_label?: string;
  action_id?: string;
};

export type CanvasButtonComponent = {
  type: "button";
  label: string;
  variant?: "primary" | "secondary" | "danger";
  action_id?: string;
};

export type CanvasDividerComponent = {
  type: "divider";
};

export type CanvasComponent =
  | CanvasTextComponent
  | CanvasMetricComponent
  | CanvasChartComponent
  | CanvasTableComponent
  | CanvasImageComponent
  | CanvasFormComponent
  | CanvasButtonComponent
  | CanvasDividerComponent;

export type CanvasSpec = {
  canvas_id: string;
  title?: string;
  components: CanvasComponent[];
};
